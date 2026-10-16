// Klient Meilisearch przez HTTP API (bez SDK, F-19): tylko operacje, których używa wyszukiwarka
// aukcji. Zapisy w Meilisearch są asynchroniczne (zadania), więc metody zapisujące zwracają numer
// zadania, a `waitForTask` czeka na jego wynik i rzuca błąd, gdy zadanie się nie udało.
// Dokumentacja: https://www.meilisearch.com/docs/reference/api/overview
import { setTimeout as sleep } from 'node:timers/promises';

export class MeiliError extends Error {
  constructor(
    message: string,
    /** Status HTTP (0: brak odpowiedzi). */
    readonly status: number,
    /** Kod błędu Meilisearch, np. `index_not_found`. */
    readonly code: string | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MeiliError';
  }
}

export interface MeiliSettings {
  readonly searchableAttributes?: readonly string[];
  readonly filterableAttributes?: readonly string[];
  readonly sortableAttributes?: readonly string[];
  readonly rankingRules?: readonly string[];
  readonly pagination?: { readonly maxTotalHits: number };
  readonly faceting?: { readonly maxValuesPerFacet: number };
}

export interface MeiliSearchRequest {
  readonly q?: string;
  readonly filter?: string;
  readonly sort?: readonly string[];
  readonly facets?: readonly string[];
  readonly page?: number;
  readonly hitsPerPage?: number;
  readonly attributesToRetrieve?: readonly string[];
}

export interface MeiliSearchResponse<T> {
  readonly hits: T[];
  readonly totalHits: number;
  readonly totalPages: number;
  readonly page: number;
  readonly hitsPerPage: number;
  readonly facetDistribution?: Record<string, Record<string, number>>;
  readonly facetStats?: Record<string, { readonly min: number; readonly max: number }>;
}

interface MeiliTask {
  readonly taskUid: number;
}

interface MeiliTaskStatus {
  readonly uid: number;
  readonly status: 'enqueued' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  readonly error?: { readonly message: string; readonly code: string } | null;
}

/** Czas oczekiwania na odpowiedź HTTP. */
const REQUEST_TIMEOUT_MS = 10_000;

export class MeiliClient {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
  ) {}

  /**
   * Zapisuje ustawienia indeksu i czeka na zadanie. Nieistniejący indeks Meilisearch tworzy tym
   * samym zadaniem, więc wyszukiwanie nigdy nie trafi na indeks bez ustawień (np. filtrów).
   */
  async updateSettings(uid: string, settings: MeiliSettings): Promise<void> {
    const task = await this.request<MeiliTask>('PATCH', `/indexes/${uid}/settings`, settings);
    await this.waitForTask(task.taskUid);
  }

  async getSettings(uid: string): Promise<MeiliSettings> {
    return this.request<MeiliSettings>('GET', `/indexes/${uid}/settings`);
  }

  /** Dodaje dokumenty albo zastępuje istniejące (klucz główny `primaryKey`). */
  async replaceDocuments(
    uid: string,
    documents: readonly object[],
    primaryKey = 'id',
  ): Promise<number> {
    const task = await this.request<MeiliTask>(
      'POST',
      `/indexes/${uid}/documents?primaryKey=${encodeURIComponent(primaryKey)}`,
      documents,
    );
    return task.taskUid;
  }

  async deleteDocuments(uid: string, ids: readonly string[]): Promise<number> {
    const task = await this.request<MeiliTask>(
      'POST',
      `/indexes/${uid}/documents/delete-batch`,
      ids,
    );
    return task.taskUid;
  }

  async search<T>(uid: string, request: MeiliSearchRequest): Promise<MeiliSearchResponse<T>> {
    return this.request<MeiliSearchResponse<T>>('POST', `/indexes/${uid}/search`, request);
  }

  /** Dokumenty bez limitu wyników wyszukiwania (np. sitemap, reindeks). */
  async fetchDocuments<T>(
    uid: string,
    options: {
      readonly fields: readonly string[];
      readonly limit: number;
      readonly offset: number;
    },
  ): Promise<{ readonly results: T[]; readonly total: number }> {
    return this.request('POST', `/indexes/${uid}/documents/fetch`, options);
  }

  /** Czeka na zakończenie zadania; nieudane albo przerwane zadanie rzuca MeiliError. */
  async waitForTask(taskUid: number, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (let delay = 25; ; delay = Math.min(delay * 2, 500)) {
      const task = await this.request<MeiliTaskStatus>('GET', `/tasks/${String(taskUid)}`);
      if (task.status === 'succeeded') {
        return;
      }
      if (task.status === 'failed' || task.status === 'canceled') {
        throw new MeiliError(
          `Zadanie Meilisearch ${String(taskUid)} nie powiodło się: ${task.error?.message ?? task.status}`,
          200,
          task.error?.code,
        );
      }
      if (Date.now() > deadline) {
        throw new MeiliError(
          `Zadanie Meilisearch ${String(taskUid)} nie skończyło się w ${String(timeoutMs)} ms`,
          0,
          'task_timeout',
        );
      }
      await sleep(delay);
    }
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new MeiliError('Meilisearch nie odpowiada', 0, undefined, { cause: error });
    }
    const text = await response.text();
    const json: unknown = text === '' ? undefined : JSON.parse(text);
    if (!response.ok) {
      const failure = (json ?? {}) as { message?: unknown; code?: unknown };
      throw new MeiliError(
        `Meilisearch: ${typeof failure.message === 'string' ? failure.message : `HTTP ${String(response.status)}`}`,
        response.status,
        typeof failure.code === 'string' ? failure.code : undefined,
      );
    }
    return json as T;
  }
}
