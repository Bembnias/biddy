import type { OrderReviewsDto, PublicReviewListDto } from '@biddy/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { OrderReviewCard } from './order-review-card';
import { ProfileReviews } from './profile-reviews';

const PUBLIC_ID = 'K3X9QA7M';
const PATH = `/v1/orders/${PUBLIC_ID}/reviews`;
const SELLER_ID = '01960000-0000-7000-8000-0000000000e2';

function state(overrides: Partial<OrderReviewsDto> = {}): OrderReviewsDto {
  return {
    orderPublicId: PUBLIC_ID,
    role: 'BUYER',
    counterpart: { id: SELLER_ID, name: 'Anna' },
    blocker: null,
    rateUntil: '2026-11-15T10:00:00.000Z',
    mine: null,
    theirs: null,
    counterpartReviewed: false,
    ...overrides,
  };
}

const MINE = {
  id: '01960000-0000-7000-8000-0000000000r1',
  rating: 4,
  comment: 'Zgodnie z opisem.',
  authorRole: 'BUYER' as const,
  createdAt: '2026-11-04T10:00:00.000Z',
  visibleAt: '2026-11-11T10:00:00.000Z',
  visible: false,
};

describe('OrderReviewCard', () => {
  it('wymaga gwiazdek, wysyła ocenę i pokazuje ją z terminem ujawnienia', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      [PATH]: state(),
      [`/v1/orders/${PUBLIC_ID}/review`]: () =>
        Response.json(state({ blocker: 'ALREADY_REVIEWED', mine: MINE }), { status: 201 }),
    });
    render(<OrderReviewCard publicId={PUBLIC_ID} />, { wrapper: AppWrapper });

    const card = await screen.findByRole('region', { name: 'Ocena transakcji' });
    expect(within(card).getByText('Jak oceniasz Anna?')).toBeDefined();
    expect(within(card).getByText(/Ocena pokaże się, gdy druga strona też oceni/u)).toBeDefined();

    await user.click(within(card).getByRole('button', { name: 'Wystaw ocenę' }));
    expect(await within(card).findByText('Wybierz ocenę od 1 do 5.')).toBeDefined();
    expect(apiCalls(fetchMock, `/v1/orders/${PUBLIC_ID}/review`)).toHaveLength(0);

    const group = within(card).getByRole('group', { name: 'Ocena' });
    await user.click(within(group).getByRole('radio', { name: '3 z 5: W porządku' }));
    // Strzałki w grupie radio zmieniają ocenę (klawiatura).
    await user.keyboard('{ArrowRight}');
    expect(within(group).getByRole('radio', { name: '4 z 5: Dobrze' })).toHaveProperty(
      'checked',
      true,
    );
    expect(within(card).queryByText('Wybierz ocenę od 1 do 5.')).toBeNull();

    const comment = within(card).getByRole('textbox', { name: 'Komentarz (opcjonalnie)' });
    await user.type(comment, 'Pisz 600 700 800');
    expect(within(card).getByText(/wygląda na dane kontaktowe/u)).toBeDefined();
    await user.click(within(card).getByRole('button', { name: 'Wystaw ocenę' }));
    expect(
      await within(card).findByText(
        'Komentarz jest publiczny: usuń numer telefonu, adres e-mail albo numer konta.',
      ),
    ).toBeDefined();
    expect(apiCalls(fetchMock, `/v1/orders/${PUBLIC_ID}/review`)).toHaveLength(0);

    await user.clear(comment);
    await user.type(comment, 'Zgodnie z opisem.');
    expect(within(card).getByText('17/1000')).toBeDefined();
    await user.click(within(card).getByRole('button', { name: 'Wystaw ocenę' }));

    expect(await within(card).findByText('Dziękujemy za ocenę.')).toBeDefined();
    expect(apiCalls(fetchMock, `/v1/orders/${PUBLIC_ID}/review`)[0]?.body).toEqual({
      rating: 4,
      comment: 'Zgodnie z opisem.',
    });
    expect(within(card).getByText('Twoja ocena')).toBeDefined();
    expect(within(card).getByRole('img', { name: '4 z 5' })).toBeDefined();
    expect(within(card).getByText(/Widoczna od 11 listopada/u)).toBeDefined();
    expect(within(card).queryByRole('button', { name: 'Wystaw ocenę' })).toBeNull();
  });

  it('druga strona już oceniła: zachęta bez treści oceny', async () => {
    mockApi({ [PATH]: state({ counterpartReviewed: true }) });
    render(<OrderReviewCard publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByText(/Druga strona już wystawiła ocenę/u)).toBeDefined();
    expect(screen.queryByText(/Ocena od Anna/u)).toBeNull();
  });

  it('obie oceny po ujawnieniu', async () => {
    mockApi({
      [PATH]: state({
        blocker: 'ALREADY_REVIEWED',
        mine: { ...MINE, visible: true },
        theirs: {
          ...MINE,
          id: 'r2',
          rating: 5,
          comment: null,
          authorRole: 'SELLER',
          visible: true,
        },
        counterpartReviewed: true,
      }),
    });
    render(<OrderReviewCard publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByText('Ocena od Anna')).toBeDefined();
    expect(screen.getByRole('img', { name: '5 z 5' })).toBeDefined();
    expect(screen.getByText('Bez komentarza')).toBeDefined();
    expect(screen.getByText('Widoczna na profilu drugiej strony.')).toBeDefined();
  });

  it('po terminie bez oceny', async () => {
    mockApi({ [PATH]: state({ blocker: 'WINDOW_CLOSED' }) });
    render(<OrderReviewCard publicId={PUBLIC_ID} />, { wrapper: AppWrapper });
    expect(await screen.findByText(/Czas na ocenę minął 15 listopada/u)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Wystaw ocenę' })).toBeNull();
  });

  it('zamówienie w toku nie pokazuje karty', async () => {
    const fetchMock = mockApi({ [PATH]: state({ blocker: 'NOT_FINISHED', rateUntil: null }) });
    const { container } = render(<OrderReviewCard publicId={PUBLIC_ID} />, {
      wrapper: AppWrapper,
    });
    await waitFor(() => {
      expect(apiCalls(fetchMock, PATH)).toHaveLength(1);
    });
    await waitFor(() => {
      expect(container.querySelector('[aria-busy]')).toBeNull();
    });
    expect(screen.queryByRole('region', { name: 'Ocena transakcji' })).toBeNull();
  });
});

describe('ProfileReviews', () => {
  const review = (index: number) => ({
    id: `01960000-0000-7000-8000-0000000001${String(index).padStart(2, '0')}`,
    rating: 5,
    comment: index === 0 ? 'Świetny kontakt.' : null,
    authorRole: 'BUYER' as const,
    authorName: 'k***a',
    title: `Przedmiot ${String(index)}`,
    createdAt: '2026-11-01T10:00:00.000Z',
  });

  it('pierwsza strona z serwera, kolejne przez „Wcześniejsze oceny”', async () => {
    const user = userEvent.setup();
    const first: PublicReviewListDto = { items: [review(0)], nextBefore: review(0).id };
    const fetchMock = mockApi({
      [`/v1/users/${SELLER_ID}/reviews`]: { items: [review(1)], nextBefore: null },
    });
    render(<ProfileReviews userId={SELLER_ID} initialPage={first} />, { wrapper: AppWrapper });

    const list = screen.getByRole('list', { name: 'Lista ocen' });
    expect(within(list).getByText('Świetny kontakt.')).toBeDefined();
    expect(within(list).getByText(/Od kupującego · k\*\*\*a/u)).toBeDefined();
    expect(within(list).getByText('1 listopada 2026')).toBeDefined();
    expect(apiCalls(fetchMock, `/v1/users/${SELLER_ID}/reviews`)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Wcześniejsze oceny' }));
    expect(await within(list).findByText('Przedmiot 1')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Wcześniejsze oceny' })).toBeNull();
  });
});
