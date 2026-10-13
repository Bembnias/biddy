// Nagłówki bezpieczeństwa (helmet). API zwraca tylko JSON, więc CSP blokuje wszystko; łagodniejsza
// polityka obowiązuje wyłącznie pod /docs, żeby Swagger UI mógł załadować skrypty i style.
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

type CspDirectives = Record<string, string[]>;

/** CSP odpowiedzi API: brak jakichkolwiek zasobów i osadzania w ramkach. */
export const API_CSP_DIRECTIVES: CspDirectives = {
  'default-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
};

/** Wartość nagłówka Content-Security-Policy z dyrektyw (format jak w @fastify/helmet). */
export function cspHeaderValue(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join(';');
}

/**
 * Minimalne nagłówki bezpieczeństwa dla odpowiedzi, których nie obsługuje helmet (błędy
 * Fastify zgłaszane przed hookami, np. zły adres URL).
 */
export const FALLBACK_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': cspHeaderValue(API_CSP_DIRECTIVES),
  'x-content-type-options': 'nosniff',
};

/** CSP dla Swagger UI: zasoby tylko z tego samego originu, style inline (wymaga ich UI). */
export const DOCS_CSP_DIRECTIVES: CspDirectives = {
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};

export function isDocsRoute(url: string, docsPath: string): boolean {
  return url === docsPath || url.startsWith(`${docsPath}/`) || url.startsWith(`${docsPath}-`);
}

/**
 * Rejestruje @fastify/helmet na instancji Fastify adaptera. Wywołać przed NestFactory.create: NestJS rejestruje
 * @fastify/middie (middleware) już przy tworzeniu aplikacji, a hooki onRequest działają
 * w kolejności rejestracji, więc tylko tak błąd z middleware ma nagłówki helmet. Hook onRoute
 * oznacza trasy dokumentacji (Swagger) dodane po nim.
 */
export async function registerSecurityHeaders(
  fastify: FastifyInstance,
  docsPath: string,
): Promise<void> {
  const docsHelmet = {
    contentSecurityPolicy: { useDefaults: false, directives: DOCS_CSP_DIRECTIVES },
  };
  fastify.addHook('onRoute', (route) => {
    if (isDocsRoute(route.url, docsPath)) {
      // @fastify/helmet czyta ustawienia trasy z config.helmet i łączy je z globalnymi.
      route.config = { ...route.config, helmet: docsHelmet };
    }
  });

  await fastify.register(helmet, {
    global: true,
    contentSecurityPolicy: { useDefaults: false, directives: API_CSP_DIRECTIVES },
  });
}
