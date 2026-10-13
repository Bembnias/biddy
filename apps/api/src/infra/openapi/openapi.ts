// Dokumentacja OpenAPI: Swagger UI pod /docs i dokument JSON pod /docs/json (źródło dla
// generowanego klienta, F-05). Domyślnie wyłączona na produkcji (OPENAPI_ENABLED).
import { readFileSync } from 'node:fs';

import { PROBLEM_CONTENT_TYPE } from '@biddy/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import type { AppConfig } from '../config/index.js';

/** Ścieżka Swagger UI (poza prefiksem /v1). */
export const DOCS_PATH = '/docs';
/** Ścieżka dokumentu OpenAPI w JSON. */
export const DOCS_JSON_PATH = '/docs/json';

/** Wersja z package.json API (ten sam poziom katalogów w src/ i dist/). */
function packageVersion(): string {
  try {
    const raw = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
    const { version } = JSON.parse(raw) as { version?: unknown };
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Wersja w dokumentacji: APP_RELEASE (np. SHA commita z CI) albo wersja pakietu. */
export function apiVersion(config: AppConfig): string {
  return config.release ?? packageVersion();
}

/** Schemat OpenAPI (pakiet nie eksportuje tego typu z głównego modułu). */
type SchemaObject = Exclude<
  NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string],
  { $ref: string }
>;

/** Schemat odpowiedzi z błędem (RFC 9457), wspólny dla wszystkich operacji. */
const PROBLEM_DETAILS_SCHEMA: SchemaObject = {
  type: 'object',
  description: `Błąd w formacie Problem Details (RFC 9457), typ treści ${PROBLEM_CONTENT_TYPE}.`,
  required: ['type', 'title', 'status', 'detail', 'instance', 'code', 'requestId'],
  properties: {
    type: { type: 'string', format: 'uri', example: 'https://biddy.pl/problems/not-found' },
    title: { type: 'string', example: 'Nie znaleziono' },
    status: { type: 'integer', example: 404 },
    detail: { type: 'string', example: 'Nie znaleziono zasobu pod tym adresem.' },
    instance: { type: 'string', example: '/v1/auctions/0199c2f0-0000-7000-8000-000000000000' },
    code: { type: 'string', description: 'Kod domenowy (ERROR_CODES z @biddy/shared).' },
    requestId: { type: 'string', description: 'Identyfikator żądania (nagłówek x-request-id).' },
    errors: {
      type: 'array',
      description: 'Błędy pól, tylko przy VALIDATION_FAILED.',
      items: {
        type: 'object',
        required: ['path', 'code', 'message'],
        properties: {
          path: { type: 'string', example: 'title' },
          code: { type: 'string', example: 'too_small' },
          message: { type: 'string' },
        },
      },
    },
  },
  additionalProperties: true,
};

/** Buduje dokument OpenAPI z kontrolerów aplikacji (wywołać po setGlobalPrefix). */
export function createOpenApiDocument(
  app: NestFastifyApplication,
  config: AppConfig,
): OpenAPIObject {
  const base = new DocumentBuilder()
    .setTitle('Biddy API')
    .setDescription(
      'REST API Biddy. Błędy mają format Problem Details (RFC 9457) z polem `code`; ' +
        'każda odpowiedź ma nagłówek x-request-id.',
    )
    .setVersion(apiVersion(config))
    .build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, base));
  return {
    ...document,
    components: {
      ...document.components,
      schemas: { ...document.components?.schemas, ProblemDetails: PROBLEM_DETAILS_SCHEMA },
    },
  };
}

/**
 * Montuje Swagger UI i dokument JSON, gdy config.openapi.enabled. Wywołać przed app.init(),
 * po registerSecurityHeaders (łagodniejsze CSP dla /docs).
 */
export function setupOpenApi(app: NestFastifyApplication, config: AppConfig): void {
  if (!config.openapi.enabled) {
    return;
  }
  const document = createOpenApiDocument(app, config);
  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: DOCS_JSON_PATH,
    raw: ['json'],
    customSiteTitle: 'Biddy API: dokumentacja',
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  });
}
