// Rewalidacja stron ISR w web (F-18, PROJECT.md §11.3): `POST {WEB_URL}/api/revalidate`
// z sekretem wspólnym z web i listą tagów cache. Bez sekretu (lokalnie, testy bez web) nic nie
// robi: strony i tak odświeżają się co 60 s.
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/index.js';

/** Ścieżka Route Handlera rewalidacji w web. */
export const WEB_REVALIDATE_PATH = '/api/revalidate';

export class WebRevalidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WebRevalidationError';
  }
}

@Injectable()
export class WebRevalidator {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Czy rewalidacja jest skonfigurowana (sekret wspólny z web). */
  get enabled(): boolean {
    return this.config.web.revalidateSecret !== undefined;
  }

  /** Unieważnia tagi cache w web; błąd sieci albo odpowiedź inna niż 2xx rzuca wyjątek. */
  async revalidate(tags: readonly string[]): Promise<void> {
    const secret = this.config.web.revalidateSecret;
    if (secret === undefined || tags.length === 0) {
      return;
    }
    let response: Response;
    try {
      response = await fetch(`${this.config.web.url}${WEB_REVALIDATE_PATH}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new WebRevalidationError('Web nie odpowiada na rewalidację stron', { cause: error });
    }
    // Treść odpowiedzi nie jest potrzebna, ale trzeba ją odczytać, żeby zwolnić połączenie.
    await response.body?.cancel();
    if (!response.ok) {
      throw new WebRevalidationError(`Web odrzucił rewalidację stron (HTTP ${response.status})`);
    }
  }
}
