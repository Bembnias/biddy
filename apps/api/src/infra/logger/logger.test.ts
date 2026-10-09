import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { type AppConfig, loadConfig } from '../config/index.js';
import { createRootLogger, serializeRequest } from './logger.js';

function memoryStream(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

function config(env: Record<string, string> = {}): AppConfig {
  return loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/db', NODE_ENV: 'test', ...env });
}

describe('createRootLogger', () => {
  it('pisze JSON z poziomem jako tekst, czasem ISO i polami usługi', () => {
    const { stream, lines } = memoryStream();
    const logger = createRootLogger(config({ APP_RELEASE: 'abc123' }), stream);

    logger.info({ auctionId: 'a1' }, 'Aukcja zakończona');

    expect(lines()).toEqual([
      expect.objectContaining({
        level: 'info',
        service: 'biddy-api',
        env: 'test',
        release: 'abc123',
        auctionId: 'a1',
        msg: 'Aukcja zakończona',
        time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) as string,
      }),
    ]);
  });

  it('respektuje poziom z konfiguracji', () => {
    const { stream, lines } = memoryStream();
    const logger = createRootLogger(config({ LOG_LEVEL: 'warn' }), stream);

    logger.info('pomijane');
    logger.warn('widoczne');

    expect(lines().map((line) => line['msg'])).toEqual(['widoczne']);
  });

  it('ukrywa nagłówki authorization, cookie i set-cookie', () => {
    const { stream, lines } = memoryStream();
    const logger = createRootLogger(config(), stream);

    logger.info(
      {
        headers: {
          authorization: 'Bearer sekret',
          cookie: 'session=sekret',
          'set-cookie': 'session=sekret',
          'user-agent': 'test',
        },
      },
      'nagłówki',
    );

    const [line] = lines();
    expect(line?.['headers']).toEqual({
      authorization: '[ukryte]',
      cookie: '[ukryte]',
      'set-cookie': '[ukryte]',
      'user-agent': 'test',
    });
    expect(JSON.stringify(lines())).not.toContain('sekret');
  });

  it('żądanie w logu: metoda, adres, IP i user-agent, bez nagłówków (sesji)', () => {
    const { stream, lines } = memoryStream();
    const logger = createRootLogger(config(), stream);
    const request = {
      method: 'POST',
      url: '/v1/bids',
      ip: '10.0.0.1',
      headers: { authorization: 'Bearer sekret', 'user-agent': 'Biddy/1.0' },
    };

    logger.info({ req: request }, 'żądanie');

    expect(lines()[0]?.['req']).toEqual({
      method: 'POST',
      url: '/v1/bids',
      remoteAddress: '10.0.0.1',
      userAgent: 'Biddy/1.0',
    });
    expect(JSON.stringify(lines())).not.toContain('sekret');
  });

  it('adres w logu jest bez parametrów zapytania (tokeny, kody OAuth, e-maile)', () => {
    const { stream, lines } = memoryStream();
    const logger = createRootLogger(config(), stream);
    const request = {
      method: 'GET',
      url: '/v1/auth/verify-email?token=SEKRETNY-TOKEN&email=jan@example.com#x',
    };

    logger.info({ req: request }, 'żądanie');

    expect(lines()[0]?.['req']).toMatchObject({ url: '/v1/auth/verify-email' });
    expect(JSON.stringify(lines())).not.toMatch(/SEKRETNY|jan@example/);
  });

  it('serializeRequest bierze IP z gniazda, gdy brak request.ip (surowe żądanie Node)', () => {
    expect(
      serializeRequest({ method: 'GET', url: '/', socket: { remoteAddress: '127.0.0.1' } }),
    ).toMatchObject({ remoteAddress: '127.0.0.1' });
  });

  it('błędy serializuje ze stosem', () => {
    const { stream, lines } = memoryStream();
    const logger = createRootLogger(config(), stream);

    logger.error({ err: new TypeError('boom') }, 'błąd');

    expect(lines()[0]?.['err']).toMatchObject({ type: 'TypeError', message: 'boom' });
  });
});
