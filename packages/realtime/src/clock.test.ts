import { describe, expect, it } from 'vitest';

import { clockSample, estimateClockOffset } from './clock.js';

describe('clockSample', () => {
  it('przesunięcie liczone od połowy zapytania', () => {
    // Wysłano o 1000, odebrano o 1200 (lokalnie); serwer odpowiedział o 6100 swojego czasu.
    expect(clockSample(new Date(6_100).toISOString(), 1_000, 1_200)).toEqual({
      offset: 5_000,
      roundTrip: 200,
    });
  });
});

describe('estimateClockOffset', () => {
  it('mediana szybszych próbek; wolne (> 1 s) odrzucone', () => {
    expect(
      estimateClockOffset([
        { offset: 5_010, roundTrip: 40 },
        { offset: 4_990, roundTrip: 60 },
        { offset: 5_005, roundTrip: 50 },
        { offset: 9_000, roundTrip: 1_500 },
        { offset: 5_200, roundTrip: 400 },
      ]),
    ).toBe(5_005);
    expect(estimateClockOffset([{ offset: 1, roundTrip: 2_000 }])).toBeUndefined();
    expect(estimateClockOffset([])).toBeUndefined();
  });

  it('opóźnienia asymetryczne i rozrzut sieci: błąd < 100 ms', () => {
    const trueOffset = -42_000;
    // Deterministyczny generator (LCG), żeby test był powtarzalny.
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 200; round += 1) {
      const samples = Array.from({ length: 5 }, () => {
        const sentAt = 1_000_000 + random() * 1_000;
        const up = 20 + random() * 180; // klient → serwer
        const down = 20 + random() * 180; // serwer → klient (inne niż w drugą stronę)
        const serverTime = new Date(sentAt + up + trueOffset).toISOString();
        return clockSample(serverTime, sentAt, sentAt + up + down);
      });
      const estimated = estimateClockOffset(samples) ?? Number.NaN;
      expect(Math.abs(estimated - trueOffset)).toBeLessThan(100);
    }
  });
});
