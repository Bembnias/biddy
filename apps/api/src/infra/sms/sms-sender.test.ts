import { describe, expect, it, vi } from 'vitest';

import { LoggingSmsSender, SmsSendError, SmsapiSmsSender, createSmsSender } from './sms-sender.js';

const MESSAGE = { to: '+48500600700', text: 'Biddy: kod 123456' };

function fetchReturning(status: number, body: string) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { status })));
}

describe('SmsapiSmsSender', () => {
  it('wysyła formularz z tokenem Bearer, numerem bez plusa i nadawcą', async () => {
    const fetchMock = fetchReturning(200, JSON.stringify({ count: 1, list: [{ id: '1' }] }));
    await new SmsapiSmsSender('t0k3n', 'Biddy', fetchMock).send(MESSAGE);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.smsapi.pl/sms.do');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t0k3n');
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      to: '48500600700',
      message: 'Biddy: kod 123456',
      format: 'json',
      encoding: 'utf-8',
      from: 'Biddy',
    });
  });

  it('bez nadawcy nie wysyła pola from (domyślny nadawca konta SMSAPI)', async () => {
    const fetchMock = fetchReturning(200, JSON.stringify({ count: 1, list: [] }));
    await new SmsapiSmsSender('t0k3n', undefined, fetchMock).send(MESSAGE);
    expect((fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams).has('from')).toBe(false);
  });

  it.each([
    [
      'błąd w treści przy statusie 200',
      200,
      JSON.stringify({ error: 13, message: 'Bad number' }),
      /kod 13/,
    ],
    ['błąd HTTP', 401, JSON.stringify({ error: 101, message: 'Authorization failed' }), /kod 101/],
    ['odpowiedź, która nie jest JSON-em', 502, '<html>', /HTTP 502/],
  ])('%s: SmsSendError', async (_label, status, body, reason) => {
    const sender = new SmsapiSmsSender('t0k3n', undefined, fetchReturning(status, body));
    await expect(sender.send(MESSAGE)).rejects.toThrow(SmsSendError);
    await expect(sender.send(MESSAGE)).rejects.toThrow(reason);
  });

  it('brak połączenia: SmsSendError z przyczyną', async () => {
    const sender = new SmsapiSmsSender('t0k3n', undefined, () =>
      Promise.reject(new TypeError('fetch failed')),
    );
    await expect(sender.send(MESSAGE)).rejects.toThrow('SMSAPI nie odpowiada');
  });
});

describe('LoggingSmsSender i createSmsSender', () => {
  it('atrapa pamięta ostatnie wiadomości na numer', async () => {
    const sender = new LoggingSmsSender();
    await sender.send(MESSAGE);
    await sender.send({ ...MESSAGE, text: 'drugi' });
    expect(sender.lastTo('+48500600700')?.text).toBe('drugi');
    expect(sender.lastTo('+48500000000')).toBeUndefined();
  });

  it('wybiera adapter według konfiguracji', () => {
    expect(createSmsSender({ kind: 'log' })).toBeInstanceOf(LoggingSmsSender);
    expect(createSmsSender({ kind: 'smsapi', token: 't', sender: undefined })).toBeInstanceOf(
      SmsapiSmsSender,
    );
  });
});
