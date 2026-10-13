// Dokumentacja OpenAPI: Swagger UI pod /docs i dokument JSON pod /docs/json (źródło dla
// generowanego klienta, F-05). Domyślnie wyłączona na produkcji (OPENAPI_ENABLED).
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

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

/** Odpowiedź z błędem dopisywana do każdej operacji (typ błędu w generowanym kliencie). */
const PROBLEM_RESPONSE = {
  description: `Błąd: Problem Details (RFC 9457, ${PROBLEM_CONTENT_TYPE}); rozpoznawaj go po polu code.`,
  content: {
    [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ProblemDetails' } },
  },
};

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'] as const;

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

/** Kontrakt OpenAPI, z którego nie da się wygenerować klienta (np. powtórzone operationId). */
export class OpenApiContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenApiContractError';
  }
}

/** Operacje dokumentu z adresem i metodą (do komunikatów). */
function operationsOf(document: OpenAPIObject): { where: string; operation: Operation }[] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = item[method];
      return operation === undefined
        ? []
        : [{ where: `${method.toUpperCase()} ${path}`, operation }];
    }),
  );
}

/**
 * operationId to nazwa metody kontrolera (np. getServerTime): od niej pochodzą nazwy funkcji
 * i hooków generowanego klienta (getServerTime, useGetServerTime). Dwie operacje o tej samej
 * nazwie dałyby w kliencie dwie funkcje o tej samej nazwie, więc to błąd przy budowie dokumentu.
 */
function assertUniqueOperationIds(document: OpenAPIObject): void {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const { where, operation } of operationsOf(document)) {
    const id = operation.operationId ?? '';
    const previous = seen.get(id);
    if (previous !== undefined) {
      duplicates.push(`${id}: ${previous} i ${where}`);
    }
    seen.set(id, where);
  }
  if (duplicates.length > 0) {
    throw new OpenApiContractError(
      `Powtórzone operationId (nazwy metod kontrolerów muszą być unikalne w całym API, bo od nich pochodzą nazwy funkcji klienta): ${duplicates.join('; ')}`,
    );
  }
}

const OUTPUT_SUFFIX = '_Output';
const SCHEMA_REF_PREFIX = '#/components/schemas/';

/**
 * nestjs-zod nazywa schemat odpowiedzi `NazwaDto_Output` (wersja „po walidacji” może różnić się
 * od wejściowej, np. pola z wartością domyślną są w niej wymagane). Gdy wersji wejściowej nie ma
 * w dokumencie albo jest identyczna, zostawiamy samą nazwę DTO: w kliencie typ to `ServerTimeDto`,
 * a nie `ServerTimeDtoOutput`. Różne wersje zostają pod dwiema nazwami.
 */
export function withoutRedundantOutputSuffix(document: OpenAPIObject): OpenAPIObject {
  const schemas = document.components?.schemas ?? {};
  const renames = new Map<string, string>();
  for (const name of Object.keys(schemas)) {
    const base = name.slice(0, -OUTPUT_SUFFIX.length);
    if (
      name.endsWith(OUTPUT_SUFFIX) &&
      (!(base in schemas) || isDeepStrictEqual(schemas[base], schemas[name]))
    ) {
      renames.set(name, base);
    }
  }
  if (renames.size === 0) {
    return document;
  }
  const renamed = JSON.parse(
    JSON.stringify(document, (key, value: unknown) => {
      if (key === '$ref' && typeof value === 'string' && value.startsWith(SCHEMA_REF_PREFIX)) {
        const name = value.slice(SCHEMA_REF_PREFIX.length);
        return `${SCHEMA_REF_PREFIX}${renames.get(name) ?? name}`;
      }
      return value;
    }),
  ) as OpenAPIObject;
  const ordered: Record<string, SchemaObject | { $ref: string }> = {};
  for (const [name, schema] of Object.entries(renamed.components?.schemas ?? {})) {
    ordered[renames.get(name) ?? name] ??= schema;
  }
  return { ...renamed, components: { ...renamed.components, schemas: ordered } };
}

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
  const document = withoutRedundantOutputSuffix(
    cleanupOpenApiDoc(
      SwaggerModule.createDocument(app, base, {
        operationIdFactory: (_controllerKey, methodKey) => methodKey,
      }),
    ),
  );
  assertUniqueOperationIds(document);
  for (const { operation } of operationsOf(document)) {
    operation.responses = { ...operation.responses, default: PROBLEM_RESPONSE };
  }
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
