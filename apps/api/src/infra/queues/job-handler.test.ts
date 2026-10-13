import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import {
  InvalidJobHandlerError,
  JOB_HANDLER_METADATA,
  JobHandler,
  ScheduledJob,
} from './job-handler.js';

class Handlers {
  @JobHandler('maintenance', 'auction.close')
  close(): void {}

  @ScheduledJob({ queue: 'maintenance', name: 'auction.sweep', every: 10_000 })
  sweep(): void {}

  @ScheduledJob({ queue: 'maintenance', name: 'search.reindex', pattern: '0 3 * * *' })
  reindex(): void {}
}

const reflector = new Reflector();

/** Metoda z prototypu (bez wywołania, tylko do odczytu metadanych). */
function method(name: 'close' | 'sweep' | 'reindex'): () => void {
  return Object.getOwnPropertyDescriptor(Handlers.prototype, name)?.value as () => void;
}

describe('@JobHandler / @ScheduledJob', () => {
  it('zapisują kolejkę, nazwę i harmonogram jako metadane metody', () => {
    expect(reflector.get(JOB_HANDLER_METADATA, method('close'))).toEqual({
      queue: 'maintenance',
      name: 'auction.close',
    });
    expect(reflector.get(JOB_HANDLER_METADATA, method('sweep'))).toEqual({
      queue: 'maintenance',
      name: 'auction.sweep',
      schedule: { every: 10_000 },
    });
    expect(reflector.get(JOB_HANDLER_METADATA, method('reindex'))).toEqual({
      queue: 'maintenance',
      name: 'search.reindex',
      schedule: { pattern: '0 3 * * *' },
    });
  });

  it.each(['close', 'Auction.close', 'auction:close', 'auction.', '.close'])(
    'odrzuca nazwę joba „%s”',
    (name) => {
      expect(() => JobHandler('maintenance', name)).toThrow(InvalidJobHandlerError);
    },
  );

  it.each([0, 999, 1.5])('odrzuca every = %s (minimum 1000 ms)', (every) => {
    expect(() => ScheduledJob({ queue: 'maintenance', name: 'a.b', every })).toThrow(
      InvalidJobHandlerError,
    );
  });
});
