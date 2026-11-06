import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

import { MEMBER, SESSIONS } from './mock-api';
import { gotoHydrated, mockBrowserApi, mockRealtime, ok, settle, signInAs } from './support';

// Wiadomości (F-29) na `next start`: pierwsza wiadomość o aukcji ze strony nowej wiadomości,
// odpowiedź sprzedającego z numerem telefonu na żywo (`message.new` z atrapy realtime) i ostrzeżenie,
// podpowiedź w polu wiadomości i blokada z wyłączonym polem. Dane pobiera przeglądarka, więc
// wystarcza atrapa API ze stanem.

type Json = Record<string, unknown>;

const AUCTION_ID = '01960000-0000-7000-8000-0000000000a1';
const SELLER_ID = '01960000-0000-7000-8000-0000000000e2';
const CONVERSATION_ID = '01960000-0000-7000-8000-0000000000c1';
const PATH = `/v1/conversations/${CONVERSATION_ID}`;

const USER = {
  id: MEMBER.id,
  name: MEMBER.name,
  avatarUrl: null,
  emailVerified: true,
  termsAccepted: true,
  phoneVerified: true,
};

const AUCTION = {
  id: AUCTION_ID,
  publicId: 'k3x9qa7p',
  slug: 'lampa-biurkowa-lata-60',
  title: 'Lampa biurkowa, lata 60.',
  coverUrl: null,
  status: 'ACTIVE',
};

const COUNTERPART = { id: SELLER_ID, name: 'Anna', avatarUrl: null, available: true };

async function expectNoAxeViolations(page: Page) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

test('pytanie o aukcję, odpowiedź z telefonem na żywo i blokada; axe i 390 px', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, SESSIONS.phoneVerified, baseURL);
  const messages: Json[] = [];
  let blocked = false;
  const conversation = (): Json => {
    const last = messages[0];
    return {
      id: CONVERSATION_ID,
      role: 'BUYER',
      counterpart: COUNTERPART,
      auction: AUCTION,
      order: null,
      lastMessage:
        last === undefined
          ? null
          : {
              preview: last['body'],
              senderRole: last['senderRole'],
              hasPhotos: false,
              createdAt: last['createdAt'],
            },
      unreadCount: messages.filter((item) => item['senderRole'] === 'SELLER' && !item['readAt'])
        .length,
      lastMessageAt: last?.['createdAt'] ?? new Date().toISOString(),
      canSend: !blocked,
      blockedByMe: blocked,
    };
  };
  const message = (id: string, senderRole: string, body: string, contactFlags: string[] = []) => ({
    id,
    senderRole,
    body,
    photos: [],
    contactFlags,
    createdAt: new Date().toISOString(),
    readAt: null,
  });

  const api = await mockBrowserApi(page, {
    'GET /v1/session': ok({ user: USER }),
    'GET /v1/conversations/summary': () => ok({ unreadCount: 0 }),
    'GET /v1/conversations/start': () =>
      ok({
        conversationId: messages.length === 0 ? null : CONVERSATION_ID,
        role: 'BUYER',
        counterpart: COUNTERPART,
        auction: AUCTION,
        order: null,
        unavailableReason: null,
        canSend: true,
        blockedByMe: false,
      }),
    'POST /v1/conversations': (request) => {
      const body = request.postDataJSON() as { body: string };
      messages.unshift(message('01960000-0000-7000-8000-0000000000b1', 'BUYER', body.body));
      return { status: 201, json: conversation() };
    },
    'GET /v1/conversations': () => ok({ items: [conversation()], nextBefore: null }),
    [`GET ${PATH}`]: () => ok(conversation()),
    [`GET ${PATH}/messages`]: () => ok({ items: messages, nextBefore: null }),
    [`POST ${PATH}/read`]: () => {
      for (const item of messages) {
        if (item['senderRole'] === 'SELLER') {
          item['readAt'] = new Date().toISOString();
        }
      }
      return ok({ unreadCount: 0 });
    },
    [`PUT /v1/me/blocks/${SELLER_ID}`]: () => {
      blocked = true;
      return { status: 204 };
    },
  });
  const realtime = await mockRealtime(page);

  await gotoHydrated(page, `/wiadomosci/nowa?aukcja=${AUCTION_ID}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Nowa wiadomość');
  await expect(main.getByText('Do: Anna')).toBeVisible();
  await expect(main.getByText(/Nie podawaj telefonu ani numeru konta/u)).toBeVisible();
  await expectNoAxeViolations(page);

  await main.getByRole('textbox', { name: 'Wiadomość' }).fill('Czy klosz ma rysy?');
  await main.getByRole('button', { name: 'Wyślij' }).click();
  await expect(page).toHaveURL(new RegExp(`/wiadomosci/${CONVERSATION_ID}$`, 'u'));
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Anna');
  await expect(
    main
      .getByRole('region', { name: 'Wiadomości w rozmowie z Anna' })
      .getByText('Czy klosz ma rysy?', { exact: true }),
  ).toBeVisible();
  expect(api.requests('POST /v1/conversations')[0]?.postDataJSON()).toEqual({
    auctionId: AUCTION_ID,
    body: 'Czy klosz ma rysy?',
    mediaIds: [],
  });

  // Sprzedający odpowiada z numerem telefonu: zdarzenie na żywo odświeża rozmowę.
  messages.unshift(
    message('01960000-0000-7000-8000-0000000000b2', 'SELLER', 'Nie ma. Zadzwoń: 600 700 800', [
      'PHONE',
    ]),
  );
  realtime.send('message.new', {
    conversationId: CONVERSATION_ID,
    messageId: '01960000-0000-7000-8000-0000000000b2',
    senderId: SELLER_ID,
    createdAt: new Date().toISOString(),
    unreadCount: 1,
    serverTime: new Date().toISOString(),
  });
  const thread = main.getByRole('region', { name: 'Wiadomości w rozmowie z Anna' });
  await expect(thread.getByText('Nie ma. Zadzwoń: 600 700 800', { exact: true })).toBeVisible();
  await expect(
    thread.getByRole('note').filter({ hasText: /zawiera numer telefonu/u }),
  ).toBeVisible();
  await expect.poll(() => api.requests(`POST ${PATH}/read`).length).toBeGreaterThan(0);
  await expectNoAxeViolations(page);

  await main.getByRole('textbox', { name: 'Wiadomość' }).fill('Mój numer to 500 600 700');
  await expect(main.getByText(/Wygląda na numer telefonu/u)).toBeVisible();
  await main.getByRole('textbox', { name: 'Wiadomość' }).fill('');

  await main.getByRole('button', { name: 'Zablokuj tę osobę' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('heading')).toHaveText('Zablokować tę osobę (Anna)?');
  await dialog.getByRole('button', { name: 'Zablokuj' }).click();
  await expect(main.getByText('Zablokowano tę osobę. Odblokuj ją, żeby napisać.')).toBeVisible();
  await expect(main.getByRole('textbox', { name: 'Wiadomość' })).toHaveCount(0);
  expect(api.requests(`PUT /v1/me/blocks/${SELLER_ID}`)).toHaveLength(1);
  await expectNoAxeViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(main.getByRole('link', { name: 'Wiadomości' })).toBeVisible();
});
