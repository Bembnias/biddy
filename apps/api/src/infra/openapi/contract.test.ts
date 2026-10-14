// Kontrakt OpenAPI, z którego orval generuje klienta (F-05): operationId = nazwa metody
// (unikalna), każda operacja ma odpowiedź z błędem ProblemDetails, nazwy schematów bez zbędnego
// `_Output`, a odpowiedzi z @ZodResponse przechodzą przez schemat DTO (nic spoza kontraktu).
import { Writable } from 'node:stream';

import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OpenAPIObject } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';
import type * as SentryNest from '@sentry/nestjs';
import type { FastifyInstance } from 'fastify';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../create-app.js';
import { type AppConfig, loadConfig } from '../config/index.js';
import {
  OpenApiContractError,
  createOpenApiDocument,
  withoutRedundantOutputSuffix,
} from './index.js';

vi.mock('@sentry/nestjs', async (importOriginal) => ({
  ...(await importOriginal<typeof SentryNest>()),
  captureException: vi.fn(),
}));

class ItemDto extends createZodDto(z.object({ id: z.string(), title: z.string() })) {}

/** z.string().nullable() psuje dokument (nestjs-zod + @nestjs/swagger widzą tablicę). */
class NullableNoteDto extends createZodDto(z.object({ note: z.string().nullable() })) {}

/** Wartość domyślna: w wersji wejściowej pole jest opcjonalne, w wyjściowej wymagane. */
class TaggedItemDto extends createZodDto(z.object({ tags: z.array(z.string()).default([]) })) {}

@ApiTags('contract')
@Controller('contract')
class ContractController {
  @Get('item')
  @ZodResponse({ type: ItemDto })
  getItem(): ItemDto {
    // Pole spoza DTO (np. dane wewnętrzne) nie może trafić do odpowiedzi.
    return { id: 'i-1', title: 'Rower', internalNote: 'tajne' } as ItemDto;
  }

  @Get('broken')
  @ZodResponse({ type: ItemDto })
  getBrokenItem(): ItemDto {
    return { id: 1 } as unknown as ItemDto;
  }

  @Post('tagged')
  @ZodResponse({ status: 201, type: TaggedItemDto })
  createTaggedItem(@Body() body: TaggedItemDto): TaggedItemDto {
    return body;
  }
}

@Module({ controllers: [ContractController] })
class ContractModule {}

@Controller('other')
class OtherController {
  @Get()
  getItem(): string {
    return 'ta sama nazwa metody co w ContractController';
  }
}

@Module({ controllers: [ContractController, OtherController] })
class DuplicateOperationModule {}

@Controller('nullable')
class NullableController {
  @Get()
  @ZodResponse({ type: NullableNoteDto })
  getNullableNote(): NullableNoteDto {
    return { note: null };
  }
}

@Module({ controllers: [NullableController] })
class NullableStringModule {}

const silent = new Writable({ write: (_chunk, _encoding, callback) => callback() });

function testConfig(): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://biddy:biddy@127.0.0.1:1/biddy',
    LOG_LEVEL: 'silent',
  });
}

let app: NestFastifyApplication;
let document: OpenAPIObject;

beforeAll(async () => {
  app = await createApp(testConfig(), { extraModules: [ContractModule], logDestination: silent });
  document = createOpenApiDocument(app, testConfig());
});

afterAll(async () => {
  await app.close();
});

function inject(method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) {
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();
  return fastify.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
}

describe('GET /v1/time', () => {
  it('zwraca czas serwera (ISO 8601 UTC) bez cache', async () => {
    const before = Date.now();
    const response = await inject('GET', '/v1/time');

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { serverTime } = response.json<{ serverTime: string }>();
    expect(serverTime).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(Date.parse(serverTime)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(serverTime)).toBeLessThanOrEqual(Date.now());
  });
});

describe('dokument OpenAPI dla generowanego klienta', () => {
  it('operationId to nazwa metody kontrolera (nazwy funkcji i hooków klienta)', () => {
    expect(document.paths['/v1/time']?.get?.operationId).toBe('getServerTime');
    expect(document.paths['/v1/contract/item']?.get?.operationId).toBe('getItem');
    expect(document.paths['/v1/contract/tagged']?.post?.operationId).toBe('createTaggedItem');
  });

  it('każda operacja ma odpowiedź default z ProblemDetails (application/problem+json)', () => {
    const operations = Object.values(document.paths).flatMap((item) =>
      [item.get, item.post, item.put, item.patch, item.delete].filter(
        (operation) => operation !== undefined,
      ),
    );
    expect(operations.length).toBeGreaterThanOrEqual(4);
    for (const operation of operations) {
      expect(operation.responses['default'], operation.operationId).toMatchObject({
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
        },
      });
    }
  });

  it('schemat odpowiedzi ma nazwę DTO bez _Output, gdy wersja wejściowa jest taka sama albo jej nie ma', () => {
    const schemas = Object.keys(document.components?.schemas ?? {});
    expect(schemas).toEqual(expect.arrayContaining(['ServerTimeDto', 'ItemDto']));
    expect(schemas).not.toContain('ServerTimeDto_Output');
    expect(schemas).not.toContain('ItemDto_Output');
    expect(document.paths['/v1/time']?.get?.responses['200']).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerTimeDto' } } },
    });
  });

  it('różne wersje wejściowa i wyjściowa zostają pod dwiema nazwami', () => {
    const schemas = document.components?.schemas ?? {};
    expect(schemas['TaggedItemDto']).toBeDefined();
    expect(schemas['TaggedItemDto']).not.toHaveProperty('required');
    expect(schemas['TaggedItemDto_Output']).toMatchObject({ required: ['tags'] });
  });

  it('z.string().nullable() (w kliencie byłaby tablica): błąd przy budowie dokumentu z podpowiedzią', async () => {
    const error: unknown = await createApp(testConfig(), {
      extraModules: [NullableStringModule],
      logDestination: silent,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OpenApiContractError);
    expect((error as Error).message).toMatch(
      /NullableNoteDto.*z\.string\(\)\.min\(1\)\.nullable\(\)/,
    );
  });

  it('powtórzona nazwa metody w dwóch kontrolerach: błąd przy budowie dokumentu', async () => {
    await expect(
      createApp(testConfig(), { extraModules: [DuplicateOperationModule], logDestination: silent }),
    ).rejects.toThrow(OpenApiContractError);
  });
});

describe('odpowiedzi przez schemat DTO (@ZodResponse)', () => {
  it('pola spoza DTO nie trafiają do odpowiedzi', async () => {
    const response = await inject('GET', '/v1/contract/item');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'i-1', title: 'Rower' });
  });

  it('wartości domyślne z DTO są w odpowiedzi', async () => {
    const response = await inject('POST', '/v1/contract/tagged', {});

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ tags: [] });
  });

  it('odpowiedź niezgodna z DTO to błąd serwera (500 INTERNAL_ERROR), a nie zepsute dane', async () => {
    const response = await inject('GET', '/v1/contract/broken');

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});

describe('withoutRedundantOutputSuffix', () => {
  const schema = { type: 'object', properties: { id: { type: 'string' } } } as const;

  it('scala identyczne X i X_Output w X i poprawia odwołania', () => {
    const result = withoutRedundantOutputSuffix({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/a': {
          get: {
            responses: {
              '200': {
                description: '',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/A_Output' } },
                },
              },
            },
          },
        },
      },
      components: { schemas: { A: schema, A_Output: schema, B: schema } },
    });

    expect(Object.keys(result.components?.schemas ?? {})).toEqual(['A', 'B']);
    expect(JSON.stringify(result.paths)).toContain('#/components/schemas/A"');
    expect(JSON.stringify(result.paths)).not.toContain('A_Output');
  });
});
