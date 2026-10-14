import type { MediaDto } from '@biddy/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileIssue } from '@/lib/media/upload';
import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { AvatarSettings } from './avatar-settings';
import { PhotoUploader } from './photo-uploader';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

/** Atrapa XHR: presigned PUT kończy się sukcesem po zdarzeniu postępu. */
class FakeXhr {
  static puts: { url: string; headers: Record<string, string>; size: number }[] = [];
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  private url = '';
  private readonly headers: Record<string, string> = {};

  open(_method: string, url: string) {
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(file: File) {
    FakeXhr.puts.push({ url: this.url, headers: this.headers, size: file.size });
    setTimeout(() => {
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: file.size,
        total: file.size,
      } as ProgressEvent);
      this.status = 200;
      this.onload?.();
    }, 0);
  }
}

function media(id: string, overrides: Partial<MediaDto> = {}): MediaDto {
  return {
    id,
    purpose: 'ITEM_PHOTO',
    status: 'READY',
    width: 1200,
    height: 900,
    urls: {
      thumb: `https://media.biddy.test/items/${id}/thumb.webp`,
      medium: `https://media.biddy.test/items/${id}/medium.webp`,
      large: `https://media.biddy.test/items/${id}/large.webp`,
    },
    rejectionReason: null,
    createdAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  };
}

/** API zdjęć: każdy upload dostaje kolejny identyfikator, stan końcowy z `final`. */
function mockMediaApi(final: (id: string) => MediaDto = (id) => media(id)) {
  let next = 0;
  const responses: Record<string, unknown> = {
    '/v1/media/uploads': () => {
      next += 1;
      const id = `0196000${String(next)}-0000-7000-8000-000000000000`;
      responses[`/v1/media/${id}/complete`] = { ...media(id), status: 'PROCESSING', urls: null };
      responses[`/v1/media/${id}`] = (method: string) =>
        method === 'DELETE' ? new Response(null, { status: 204 }) : final(id);
      return Response.json(
        {
          media: { ...media(id), status: 'PENDING_UPLOAD', urls: null },
          upload: {
            url: `https://s3.biddy.test/uploads/${id}`,
            method: 'PUT',
            headers: { 'content-type': 'image/jpeg' },
            expiresAt: '2026-10-14T10:15:00.000Z',
          },
        },
        { status: 201 },
      );
    },
  };
  return mockApi(responses);
}

const jpeg = (name: string, size = 2048) =>
  new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

beforeEach(() => {
  FakeXhr.puts = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  router.refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fileIssue', () => {
  it('typ i rozmiar sprawdzane przed wysłaniem', () => {
    expect(fileIssue(jpeg('a.jpg'))).toBeUndefined();
    expect(fileIssue(new File(['x'], 'a.gif', { type: 'image/gif' }))).toBe('type');
    expect(fileIssue(jpeg('duze.jpg', 16 * 1024 * 1024))).toBe('size');
  });
});

describe('PhotoUploader', () => {
  it('wysyła zdjęcia przez presigned PUT, pokazuje miniatury, zdjęcie główne i kolejność', async () => {
    const api = mockMediaApi();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<PhotoUploader onChange={onChange} />, { wrapper: AppWrapper });

    await user.upload(screen.getByLabelText('Dodaj zdjęcia', { selector: 'input' }), [
      jpeg('pierwsze.jpg'),
      jpeg('drugie.jpg', 4096),
    ]);

    expect(await screen.findByRole('img', { name: 'Zdjęcie 2' }, { timeout: 4000 })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Zdjęcie 1' })).toBeDefined();
    expect(screen.getByText('Zdjęcie główne')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Zdjęcia (2/20)' })).toBeDefined();
    expect(FakeXhr.puts.map((put) => [put.headers['content-type'], put.size])).toEqual([
      ['image/jpeg', 2048],
      ['image/jpeg', 4096],
    ]);
    expect(apiCalls(api, '/v1/media/uploads')[0]?.body).toEqual({
      purpose: 'ITEM_PHOTO',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });
    const [first, second] = onChange.mock.lastCall?.[0] as string[];

    await user.click(screen.getByRole('button', { name: 'Przesuń zdjęcie 1 w prawo' }));
    expect(onChange).toHaveBeenLastCalledWith([second, first]);

    await user.click(screen.getByRole('button', { name: 'Usuń zdjęcie 1' }));
    expect(onChange).toHaveBeenLastCalledWith([first]);
    await waitFor(() => {
      expect(apiCalls(api, `/v1/media/${second ?? ''}`)).toHaveLength(2);
    });
  });

  it('zły typ pliku: komunikat bez wysyłki; zdjęcie do moderacji i odrzucone: komunikaty', async () => {
    let calls = 0;
    mockMediaApi((id) => {
      calls += 1;
      return calls === 1
        ? media(id, { status: 'FLAGGED', urls: null })
        : media(id, { status: 'REJECTED', urls: null, rejectionReason: 'Zdjęcie jest za małe.' });
    });
    const user = userEvent.setup({ applyAccept: false });
    render(<PhotoUploader />, { wrapper: AppWrapper });
    const input = screen.getByLabelText('Dodaj zdjęcia', { selector: 'input' });

    await user.upload(input, new File(['x'], 'plik.gif', { type: 'image/gif' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Dodaj zdjęcie JPEG, PNG albo WebP.',
    );
    expect(FakeXhr.puts).toHaveLength(0);

    await user.upload(input, [jpeg('czerwone.jpg'), jpeg('male.jpg')]);
    expect(
      await screen.findByText(
        'Zdjęcie czeka na sprawdzenie przez moderatora.',
        {},
        { timeout: 4000 },
      ),
    ).toBeDefined();
    await waitFor(
      () => {
        expect(screen.getAllByRole('alert')).toHaveLength(2);
      },
      { timeout: 4000 },
    );
    const items = screen.getAllByRole('listitem');
    expect(within(items[2] as HTMLElement).getByRole('alert').textContent).toBe(
      'Zdjęcie jest za małe.',
    );
  });
});

describe('AvatarSettings', () => {
  it('upload zdjęcia profilowego i ustawienie przez PUT /v1/me/avatar', async () => {
    const avatarUrl = 'https://media.biddy.test/avatars/a/large.webp';
    const api = mockMediaApi((id) => media(id, { purpose: 'AVATAR' }));
    const responses = api.getMockImplementation();
    api.mockImplementation((input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      return url.pathname === '/v1/me/avatar'
        ? Promise.resolve(Response.json({ avatarUrl }))
        : (responses?.(input, init) ?? Promise.reject(new Error('brak atrapy')));
    });
    const user = userEvent.setup();
    render(<AvatarSettings userId="u-1" name="Kasia Kupująca" avatarUrl={null} />, {
      wrapper: AppWrapper,
    });
    expect(screen.getByRole('img', { name: 'Zdjęcie profilowe: Kasia Kupująca' }).tagName).toBe(
      'SPAN',
    );

    await user.upload(screen.getByLabelText('Dodaj zdjęcie'), jpeg('ja.jpg'));

    await waitFor(
      () => {
        expect(screen.getByRole('status').textContent).toBe('Zapisano zdjęcie profilowe.');
      },
      { timeout: 4000 },
    );
    expect(
      screen.getByRole('img', { name: 'Zdjęcie profilowe: Kasia Kupująca' }).getAttribute('src'),
    ).toBe(avatarUrl);
    expect(apiCalls(api, '/v1/media/uploads')[0]?.body).toMatchObject({ purpose: 'AVATAR' });
    expect(router.refresh).toHaveBeenCalled();
  });
});
