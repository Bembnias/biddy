import { describe, expect, it } from 'vitest';

import {
  IP_FAILURE_THRESHOLD,
  LOGIN_FAILURE_THRESHOLD,
  LOGIN_FAILURE_WINDOW_MS,
  MAX_LOGIN_BACKOFF_MS,
  loginBackoffMs,
  throttleDecision,
  throttleKeys,
} from './login-throttle.js';

const NOW = new Date('2026-12-24T19:00:00.000Z');

function secondsAgo(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1_000);
}

describe('loginBackoffMs', () => {
  it('poniżej progu bez przerwy, potem 2 s, 4 s, 8 s… do 5 minut', () => {
    expect([1, 4, 5, 6, 7, 20].map((failures) => loginBackoffMs(failures))).toEqual([
      0,
      0,
      2_000,
      4_000,
      8_000,
      MAX_LOGIN_BACKOFF_MS,
    ]);
  });

  it('próg IP jest wyższy niż próg konta', () => {
    expect(IP_FAILURE_THRESHOLD).toBeGreaterThan(LOGIN_FAILURE_THRESHOLD);
    expect(loginBackoffMs(19, IP_FAILURE_THRESHOLD)).toBe(0);
    expect(loginBackoffMs(20, IP_FAILURE_THRESHOLD)).toBe(2_000);
  });
});

describe('throttleDecision', () => {
  it('4 porażki na konto: bez Turnstile i bez przerwy', () => {
    expect(
      throttleDecision([{ key: 'email:a@b.pl', failures: 4, lastFailureAt: secondsAgo(0) }], NOW),
    ).toEqual({ captchaRequired: false, retryAfterMs: 0 });
  });

  it('5 porażek na konto: Turnstile i przerwa liczona od ostatniej porażki', () => {
    expect(
      throttleDecision([{ key: 'email:a@b.pl', failures: 5, lastFailureAt: secondsAgo(0.5) }], NOW),
    ).toEqual({ captchaRequired: true, retryAfterMs: 1_500 });
  });

  it('po przerwie: Turnstile nadal wymagany, czekać już nie trzeba', () => {
    expect(
      throttleDecision([{ key: 'email:a@b.pl', failures: 5, lastFailureAt: secondsAgo(60) }], NOW),
    ).toEqual({ captchaRequired: true, retryAfterMs: 0 });
  });

  it('IP i konto: Turnstile, gdy którykolwiek przekroczy swój próg; obowiązuje dłuższa przerwa', () => {
    const decision = throttleDecision(
      [
        { key: 'email:a@b.pl', failures: 6, lastFailureAt: secondsAgo(1) },
        { key: 'ip:1.2.3.4', failures: 3, lastFailureAt: secondsAgo(0) },
      ],
      NOW,
    );
    expect(decision).toEqual({ captchaRequired: true, retryAfterMs: 3_000 });
    expect(
      throttleDecision([{ key: 'ip:1.2.3.4', failures: 10, lastFailureAt: secondsAgo(0) }], NOW)
        .captchaRequired,
    ).toBe(false);
  });

  it('porażki sprzed doby się nie liczą', () => {
    expect(
      throttleDecision(
        [
          {
            key: 'email:a@b.pl',
            failures: 50,
            lastFailureAt: new Date(NOW.getTime() - LOGIN_FAILURE_WINDOW_MS),
          },
        ],
        NOW,
      ),
    ).toEqual({ captchaRequired: false, retryAfterMs: 0 });
  });
});

describe('throttleKeys', () => {
  it('e-mail małymi literami bez spacji, IP osobno; puste wartości pominięte', () => {
    expect(throttleKeys(' Jan@Example.COM ', '1.2.3.4')).toEqual([
      'email:jan@example.com',
      'ip:1.2.3.4',
    ]);
    expect(throttleKeys(undefined, '')).toEqual([]);
  });
});
