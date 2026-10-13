// Bezpiecznik `pnpm storage:setup`: czysta funkcja bez efektów ubocznych, łatwa do przetestowania.
// Tworzenie kubełków i nadpisywanie reguły CORS dopuszczamy wyłącznie dla serwera S3 na tej
// maszynie (RustFS z docker compose) i poza produkcją. Te same nazwy zmiennych (S3_ENDPOINT,
// S3_ACCESS_KEY_ID…) wskazują na produkcji na Cloudflare R2, gdzie PutBucketCors zastąpiłby
// całą konfigurację CORS prawdziwego kubełka.
import { isLocalHostname } from './net.js';

export type StorageSafetyResult = { ok: true } | { ok: false; reason: string };

export function checkStorageSafety(
  s3Endpoint: string,
  nodeEnv: string | undefined,
): StorageSafetyResult {
  if (nodeEnv === 'production') {
    return {
      ok: false,
      reason: 'NODE_ENV=production: tworzenie kubełków i zmiana CORS są zablokowane.',
    };
  }

  const url = URL.parse(s3Endpoint);
  if (url === null || !['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, reason: 'S3_ENDPOINT nie jest poprawnym adresem http(s)://….' };
  }

  if (!isLocalHostname(url.hostname)) {
    return {
      ok: false,
      reason: `S3_ENDPOINT wskazuje na host „${url.hostname}”; kubełki i CORS ustawiamy tylko w lokalnym RustFS (localhost, 127.0.0.1, ::1).`,
    };
  }

  return { ok: true };
}
