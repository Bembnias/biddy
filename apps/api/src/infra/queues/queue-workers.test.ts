import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';

import { DEFAULT_JOB_OPTIONS, QUEUE_DEFINITIONS, jobOptionsFor } from './queue-catalog.js';
import {
  DuplicateJobHandlerError,
  type RegisteredJobHandler,
  groupHandlers,
  isFinalFailure,
  toJobRun,
} from './queue-workers.js';

function handler(queue: 'maintenance' | 'domain-events', name: string, source: string) {
  return {
    queue,
    name,
    source,
    handle: () => Promise.resolve(undefined),
  } satisfies RegisteredJobHandler;
}

describe('isFinalFailure (po zapisaniu porażki próby)', () => {
  it('ostatnia próba: attemptsMade osiągnęło attempts', () => {
    expect(isFinalFailure({ attemptsMade: 3, opts: { attempts: 3 } }, new Error('x'))).toBe(true);
  });

  it('wcześniejsza próba: job wróci z backoffem', () => {
    expect(isFinalFailure({ attemptsMade: 1, opts: { attempts: 3 } }, new Error('x'))).toBe(false);
  });

  it('UnrecoverableError kończy job od razu (także po nazwie, np. z procesu potomnego)', () => {
    const named = Object.assign(new Error('x'), { name: 'UnrecoverableError' });
    expect(
      isFinalFailure({ attemptsMade: 1, opts: { attempts: 10 } }, new UnrecoverableError()),
    ).toBe(true);
    expect(isFinalFailure({ attemptsMade: 1, opts: { attempts: 10 } }, named)).toBe(true);
  });

  it('bez attempts w opcjach job ma jedną próbę', () => {
    expect(isFinalFailure({ attemptsMade: 1, opts: {} }, new Error('x'))).toBe(true);
  });
});

describe('toJobRun', () => {
  it('numer próby od 1 i liczba prób z opcji joba', () => {
    const run = toJobRun<{ a: number }>('maintenance', {
      id: 'job-1',
      name: 'outbox.cleanup',
      data: { a: 1 },
      attemptsMade: 2,
      opts: { attempts: 5 },
    } as never);
    expect(run).toEqual({
      id: 'job-1',
      name: 'outbox.cleanup',
      queue: 'maintenance',
      data: { a: 1 },
      attempt: 3,
      maxAttempts: 5,
    });
  });
});

describe('groupHandlers', () => {
  it('grupuje handlery według kolejki i nazwy joba', () => {
    const grouped = groupHandlers([
      handler('maintenance', 'outbox.cleanup', 'OutboxMaintenance.cleanup'),
      handler('maintenance', 'auction.sweep', 'Sweeper.sweep'),
      handler('domain-events', 'notifications.outbid-email', 'Notifications.outbid'),
    ]);
    expect([...grouped.keys()]).toEqual(['maintenance', 'domain-events']);
    expect([...(grouped.get('maintenance')?.keys() ?? [])]).toEqual([
      'outbox.cleanup',
      'auction.sweep',
    ]);
  });

  it('ten sam job w tej samej kolejce dwa razy → błąd ze wskazaniem obu miejsc', () => {
    expect(() =>
      groupHandlers([
        handler('maintenance', 'outbox.cleanup', 'A.cleanup'),
        handler('maintenance', 'outbox.cleanup', 'B.cleanup'),
      ]),
    ).toThrow(
      new DuplicateJobHandlerError(
        'Job „outbox.cleanup” w kolejce maintenance ma dwa handlery: A.cleanup i B.cleanup',
      ),
    );
  });
});

describe('katalog kolejek', () => {
  it('domyślnie 10 prób z wykładniczym backoffem od 2 s (łącznie ok. 17 minut) i rozrzutem', () => {
    expect(DEFAULT_JOB_OPTIONS).toMatchObject({
      attempts: 10,
      backoff: { type: 'exponential', delay: 2_000, jitter: 0.5 },
    });
    // Odstępy przed próbami 2…10: 2 s · 2^(n-1).
    const totalMs = Array.from({ length: 9 }, (_, n) => 2_000 * 2 ** n).reduce((a, b) => a + b);
    expect(totalMs / 60_000).toBeCloseTo(17, 0);
  });

  it('każda kolejka katalogu ma współbieżność ≥ 1 i opcje jobów z wartościami domyślnymi', () => {
    for (const [name, definition] of Object.entries(QUEUE_DEFINITIONS)) {
      expect(definition.concurrency, name).toBeGreaterThanOrEqual(1);
      expect(jobOptionsFor(name as keyof typeof QUEUE_DEFINITIONS)).toMatchObject({
        attempts: DEFAULT_JOB_OPTIONS.attempts,
      });
    }
  });

  it('nazwy kolejek nie mają dwukropka (separator kluczy BullMQ)', () => {
    for (const name of Object.keys(QUEUE_DEFINITIONS)) {
      expect(name).toMatch(/^[a-z][a-z-]*$/);
    }
  });
});
