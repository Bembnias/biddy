import { Controller, Get, Header, Inject, Logger } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { DatabaseHealth } from '../db/index.js';
import { DomainError } from '../http/index.js';
import { HEALTH_PATH, READY_PATH, READY_TIMEOUT_MS } from './health.constants.js';

export interface HealthResponse {
  readonly status: 'ok';
  readonly release: string | null;
}

export interface ReadyResponse {
  readonly status: 'ok';
  readonly checks: { readonly database: 'ok' };
}

class CheckTimeoutError extends Error {
  constructor(ms: number) {
    super(`Sprawdzenie nie zakończyło się w ${ms} ms`);
    this.name = 'CheckTimeoutError';
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CheckTimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sondy dla platformy i load balancera (poza prefiksem /v1 i poza OpenAPI).
 * - /health (liveness): proces działa; nie sprawdza zależności, żeby awaria bazy nie
 *   powodowała restartów kontenera.
 * - /ready (readiness): baza odpowiada; inaczej 503 i ruch omija tę instancję.
 */
@ApiExcludeController()
@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseHealth,
  ) {}

  @Get(HEALTH_PATH)
  @Header('cache-control', 'no-store')
  health(): HealthResponse {
    return { status: 'ok', release: this.config.release ?? null };
  }

  @Get(READY_PATH)
  @Header('cache-control', 'no-store')
  async ready(): Promise<ReadyResponse> {
    try {
      await withTimeout(this.database.check(), READY_TIMEOUT_MS);
    } catch (error) {
      this.logger.warn({ err: error }, 'Sonda /ready: baza danych nie odpowiada');
      throw new DomainError({
        code: 'SERVICE_UNAVAILABLE',
        detail: 'Baza danych nie odpowiada. Spróbuj ponownie za chwilę.',
        extensions: { checks: { database: 'error' } },
        cause: error,
      });
    }
    return { status: 'ok', checks: { database: 'ok' } };
  }
}
