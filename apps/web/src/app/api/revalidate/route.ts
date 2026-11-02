// Rewalidacja stron aukcji (F-18): woła ją worker API po zdarzeniach aukcji, najwyżej raz na 5 s
// na stronę. `expire: 0`: następne żądanie renderuje stronę od nowa, zamiast podać starą wersję,
// więc HTML bez JavaScriptu pokazuje cenę nie starszą niż ok. 10 s.
import { revalidateTag } from 'next/cache';

import { revalidateSecret } from '@/env';
import { handleRevalidate } from '@/lib/auction/revalidate';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const result = handleRevalidate(
    { authorization: request.headers.get('authorization'), body },
    revalidateSecret(),
    (tag) => {
      revalidateTag(tag, { expire: 0 });
    },
  );
  return Response.json(result.body, {
    status: result.status,
    headers: { 'cache-control': 'no-store' },
  });
}
