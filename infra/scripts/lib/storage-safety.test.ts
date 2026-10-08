import { describe, expect, it } from 'vitest';

import { checkStorageSafety } from './storage-safety.js';

function reasonFor(endpoint: string, nodeEnv?: string): string {
  const result = checkStorageSafety(endpoint, nodeEnv);
  if (result.ok) {
    throw new Error(`Oczekiwano odmowy dla ${endpoint}`);
  }
  return result.reason;
}

describe('checkStorageSafety', () => {
  it.each([
    'http://localhost:9000',
    'http://127.0.0.1:9100',
    'http://[::1]:9000',
    'http://LOCALHOST:9000/',
  ])('pozwala na kubełki i CORS w lokalnym RustFS %s', (endpoint) => {
    expect(checkStorageSafety(endpoint, 'development')).toEqual({ ok: true });
    expect(checkStorageSafety(endpoint, undefined)).toEqual({ ok: true });
  });

  it.each([
    // Cloudflare R2: te same nazwy zmiennych co lokalnie, więc łatwo o pomyłkę.
    'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com',
    'https://s3.eu-central-1.amazonaws.com',
    'http://127.0.0.2:19555',
    'http://10.0.0.5:9000',
    'http://localhost.example.com:9000',
  ])('odmawia dla serwera S3 spoza tej maszyny %s', (endpoint) => {
    expect(reasonFor(endpoint, 'development')).toContain('tylko w lokalnym RustFS');
  });

  it('odmawia przy NODE_ENV=production, nawet dla localhost', () => {
    expect(reasonFor('http://localhost:9000', 'production')).toContain('NODE_ENV=production');
  });

  it('odmawia dla adresu, który nie jest adresem http(s)', () => {
    expect(reasonFor('to nie jest url')).toContain('S3_ENDPOINT');
    expect(reasonFor('ftp://localhost:9000')).toContain('S3_ENDPOINT');
  });
});
