// Konfiguracja aplikacji web walidowana Zodem. next.config.ts sprawdza ją przy buildzie i starcie
// (błędna wartość przerywa `next build`) i przekazuje wynik do kodu (src/config.ts).
//
// Zmienne NEXT_PUBLIC_* Next.js wkleja do kodu przy buildzie, więc trafiają do przeglądarki: nie
// może być wśród nich sekretów. Next podmienia tylko dosłowne odwołania `process.env.NEXT_PUBLIC_X`,
// dlatego publicEnvInput() wymienia każdą zmienną z nazwy.
import { z } from 'zod';

export const ENVIRONMENTS = ['local', 'preview', 'staging', 'production'] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

/** Pusta wartość (np. `NEXT_PUBLIC_SENTRY_DSN=` w .env) znaczy to samo co brak zmiennej. */
function emptyAsMissing<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );
}

function httpUrl(example: string) {
  return z
    .string()
    .trim()
    .refine((value) => {
      const parsed = URL.parse(value);
      return parsed !== null && ['http:', 'https:'].includes(parsed.protocol);
    }, `oczekiwano adresu http(s)://, np. ${example}`)
    .transform((value) => value.replace(/\/+$/, ''));
}

export const publicEnvSchema = z
  .object({
    /** Środowisko wdrożenia: tylko `production` pozwala indeksować stronę (robots.txt). */
    NEXT_PUBLIC_ENVIRONMENT: emptyAsMissing(z.enum(ENVIRONMENTS).default('local')),
    /** Adres API bez /v1 (ścieżki z kontraktu zawierają prefiks). */
    NEXT_PUBLIC_API_URL: emptyAsMissing(httpUrl('https://api.biddy.pl').optional()),
    /** Publiczny adres aplikacji web (metadata, Open Graph, robots.txt). */
    NEXT_PUBLIC_SITE_URL: emptyAsMissing(httpUrl('https://biddy.pl').optional()),
    NEXT_PUBLIC_SENTRY_DSN: emptyAsMissing(
      httpUrl('https://klucz@o0.ingest.de.sentry.io/0').optional(),
    ),
    NEXT_PUBLIC_POSTHOG_KEY: emptyAsMissing(z.string().trim().optional()),
    NEXT_PUBLIC_POSTHOG_HOST: emptyAsMissing(
      httpUrl('https://eu.i.posthog.com').default('https://eu.i.posthog.com'),
    ),
    NEXT_PUBLIC_APP_RELEASE: emptyAsMissing(z.string().trim().optional()),
  })
  .superRefine((env, ctx) => {
    // Poza środowiskiem lokalnym adresy localhost byłyby błędem konfiguracji, a nie wygodą.
    if (env.NEXT_PUBLIC_ENVIRONMENT === 'local') {
      return;
    }
    for (const key of ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_SITE_URL'] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `wymagana poza środowiskiem lokalnym (NEXT_PUBLIC_ENVIRONMENT=${env.NEXT_PUBLIC_ENVIRONMENT})`,
        });
      }
    }
  })
  .transform((env) => ({
    environment: env.NEXT_PUBLIC_ENVIRONMENT,
    apiUrl: env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
    siteUrl: env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    sentryDsn: env.NEXT_PUBLIC_SENTRY_DSN,
    posthogKey: env.NEXT_PUBLIC_POSTHOG_KEY,
    posthogHost: env.NEXT_PUBLIC_POSTHOG_HOST,
    release: env.NEXT_PUBLIC_APP_RELEASE,
  }));

export type PublicEnv = z.output<typeof publicEnvSchema>;

/** Zmienne NEXT_PUBLIC_* wymienione z nazwy (tylko tak Next.js wkleja je do kodu przeglądarki). */
export function publicEnvInput(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_ENVIRONMENT: process.env.NEXT_PUBLIC_ENVIRONMENT,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_APP_RELEASE: process.env.NEXT_PUBLIC_APP_RELEASE,
  };
}

/** Błędna konfiguracja: wszystkie złe zmienne naraz, po polsku. */
export class WebConfigError extends Error {
  constructor(issues: readonly { readonly variable: string; readonly message: string }[]) {
    super(
      [
        'Nieprawidłowa konfiguracja aplikacji web (zmienne środowiskowe):',
        ...issues.map((issue) => `  • ${issue.variable}: ${issue.message}`),
        '',
        'Opis zmiennych: sekcja „Web” w .env.example.',
      ].join('\n'),
    );
    this.name = 'WebConfigError';
  }
}

/** Waliduje zmienne publiczne; rzuca WebConfigError z listą problemów. */
export function parsePublicEnv(input: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(input);
  if (!result.success) {
    throw new WebConfigError(
      result.error.issues.map((issue) => ({
        variable: issue.path.map(String).join('.') || '(całość)',
        message: issue.message,
      })),
    );
  }
  return result.data;
}
