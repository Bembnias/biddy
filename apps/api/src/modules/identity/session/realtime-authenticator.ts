import type { IncomingHttpHeaders } from 'node:http';

import { Injectable } from '@nestjs/common';

import type { RealtimeAuthenticator } from '../../../infra/realtime/index.js';
import { SessionReader } from './session.guard.js';

/**
 * Sesja połączenia WebSocket (F-17): ciasteczko z handshake (web) albo token Bearer z
 * `auth.token` (aplikacja mobilna), ten sam odczyt co w REST. Konto zablokowane albo brak sesji:
 * połączenie anonimowe.
 */
@Injectable()
export class SessionRealtimeAuthenticator implements RealtimeAuthenticator {
  constructor(private readonly sessions: SessionReader) {}

  async authenticate(
    headers: IncomingHttpHeaders,
    token: string | undefined,
  ): Promise<string | null> {
    const session = await this.sessions.read({
      headers: token === undefined ? headers : { authorization: `Bearer ${token}` },
    });
    if (session === null || session.user.status === 'BANNED') {
      return null;
    }
    return session.user.id;
  }
}
