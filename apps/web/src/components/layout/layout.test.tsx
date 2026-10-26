import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockApi } from '@/test/api';

import { AppWrapper, IntlWrapper } from '@/test/providers';

import { BottomNav } from './bottom-nav';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';
import { SkipLink } from './skip-link';

const pathname = { current: '/' };
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

beforeEach(() => {
  pathname.current = '/';
});

describe('nagłówek', () => {
  it('logo prowadzi na stronę główną, akcje mają etykiety także jako ikony', () => {
    render(<SiteHeader />, { wrapper: AppWrapper });

    expect(screen.getByRole('link', { name: 'Biddy, strona główna' }).getAttribute('href')).toBe(
      '/',
    );
    const navigation = screen.getByRole('navigation', { name: 'Nawigacja główna' });
    expect(
      within(navigation).getByRole('link', { name: 'Wystaw przedmiot' }).getAttribute('href'),
    ).toBe('/wystaw');
    expect(within(navigation).getByRole('link', { name: 'Zaloguj się' }).getAttribute('href')).toBe(
      '/logowanie',
    );
  });

  it('wyszukiwarka: formularz GET /szukaj z polem q i etykietą', () => {
    render(<SiteHeader />, { wrapper: AppWrapper });

    const search = screen.getByRole('search');
    expect(search.getAttribute('action')).toBe('/szukaj');
    expect(search.getAttribute('method')).toBe('get');
    const input = within(search).getByRole('searchbox', { name: 'Szukaj na Biddy' });
    expect(input.getAttribute('name')).toBe('q');
    expect(within(search).getByRole('button', { name: 'Szukaj' })).toBeDefined();
  });
});

describe('menu użytkownika (GET /v1/session)', () => {
  it('gość widzi „Zaloguj się”, zalogowany „Moje konto”', async () => {
    mockApi({ '/v1/session': { user: null } });
    const { unmount } = render(<SiteHeader />, { wrapper: AppWrapper });
    expect(await screen.findByRole('link', { name: 'Zaloguj się' })).toBeDefined();
    unmount();

    mockApi({
      '/v1/session': {
        user: { id: 'u1', name: 'Jan', emailVerified: true, termsAccepted: true },
      },
    });
    render(<SiteHeader />, { wrapper: AppWrapper });
    expect((await screen.findByRole('link', { name: 'Moje konto' })).getAttribute('href')).toBe(
      '/konto',
    );
  });
});

describe('link „Przejdź do treści”', () => {
  it('prowadzi do #main', () => {
    render(<SkipLink />, { wrapper: IntlWrapper });
    expect(screen.getByRole('link', { name: 'Przejdź do treści' }).getAttribute('href')).toBe(
      '#main',
    );
  });
});

describe('stopka', () => {
  it('grupy linków informacyjnych i prawnych oraz rok', () => {
    render(<SiteFooter year={2027} />, { wrapper: IntlWrapper });

    const footer = screen.getByRole('contentinfo', { name: 'Stopka' });
    for (const group of ['Biddy', 'Pomoc', 'Zasady']) {
      expect(within(footer).getByRole('navigation', { name: group })).toBeDefined();
    }
    expect(within(footer).getByRole('link', { name: 'Regulamin' }).getAttribute('href')).toBe(
      '/regulamin',
    );
    expect(within(footer).getByText(/© 2027 Biddy/)).toBeDefined();
  });
});

describe('dolny pasek nawigacji na telefonie (F-63, D4)', () => {
  it('pięć skrótów, bieżąca strona oznaczona aria-current', () => {
    pathname.current = '/kategoria/moda';
    render(<BottomNav />, { wrapper: IntlWrapper });

    const navigation = screen.getByRole('navigation', { name: 'Szybka nawigacja' });
    const links = within(navigation).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Start', '/'],
      ['Szukaj', '/szukaj'],
      ['Wystaw', '/wystaw'],
      ['Moje Biddy', '/moje-biddy'],
      ['Konto', '/konto'],
    ]);
    expect(
      within(navigation).getByRole('link', { name: 'Szukaj' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(navigation).getByRole('link', { name: 'Start' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('na stronie aukcji go nie ma (pasek licytacji), stopka nie rezerwuje na niego miejsca', () => {
    pathname.current = '/a/zegarek-casio-k3x9qa7m';
    const { container } = render(
      <>
        <BottomNav />
        <SiteFooter year={2027} />
      </>,
      { wrapper: IntlWrapper },
    );
    expect(screen.queryByRole('navigation', { name: 'Szybka nawigacja' })).toBeNull();
    expect(container.querySelector('footer > div.h-16')).toBeNull();
  });
});
