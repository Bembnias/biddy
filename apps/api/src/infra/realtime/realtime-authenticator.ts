import type { IncomingHttpHeaders } from 'node:http';

/**
 * Uwierzytelnienie połączenia WebSocket (F-17): nagłówki żądania handshake (ciasteczko sesji)
 * albo token Bearer z `auth.token` (aplikacja mobilna) → identyfikator konta albo null
 * (połączenie anonimowe). Implementuje moduł identity; infra zna tylko ten kontrakt.
 */
export interface RealtimeAuthenticator {
  authenticate(headers: IncomingHttpHeaders, token: string | undefined): Promise<string | null>;
}

export const REALTIME_AUTHENTICATOR = Symbol('REALTIME_AUTHENTICATOR');
