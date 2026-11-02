// Preferencje powiadomień (F-20): w MVP konfigurowalny jest kanał EMAIL (in-app zawsze
// włączone). Brak wiersza = wartość domyślna z NOTIFICATION_EMAIL; e-maile transakcyjne
// (wygrana, sprzedaż) wychodzą zawsze.
import {
  NOTIFICATION_EMAIL,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationType,
} from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { notificationPreferences } from '../db/notifications.schema.js';
import type { UnsubscribeScope } from './unsubscribe-token.js';

export interface PreferenceEntry {
  readonly type: NotificationType;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  /** Czy użytkownik może to zmienić. */
  readonly configurable: boolean;
}

@Injectable()
export class PreferenceService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(userId: string): Promise<PreferenceEntry[]> {
    const stored = await this.stored(userId);
    return NOTIFICATION_TYPES.flatMap((type) => [
      { type, channel: 'IN_APP' as const, enabled: true, configurable: false },
      {
        type,
        channel: 'EMAIL' as const,
        enabled: emailEnabled(type, stored.get(type)),
        configurable: NOTIFICATION_EMAIL[type].configurable,
      },
    ]);
  }

  /** Zmiana preferencji; niekonfigurowalnej pozycji nie da się zmienić (400). */
  async update(
    userId: string,
    changes: readonly { type: NotificationType; channel: NotificationChannel; enabled: boolean }[],
  ): Promise<PreferenceEntry[]> {
    const invalid = changes.find(
      (change) => change.channel !== 'EMAIL' || !NOTIFICATION_EMAIL[change.type].configurable,
    );
    if (invalid !== undefined) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        detail: 'Tego powiadomienia nie można wyłączyć.',
        errors: [
          {
            path: 'items',
            code: 'custom',
            message: `${invalid.type} / ${invalid.channel}: zawsze włączone.`,
          },
        ],
      });
    }
    await this.save(
      userId,
      changes.map((change) => ({ type: change.type, enabled: change.enabled })),
    );
    return this.list(userId);
  }

  /** Wypisanie z e-maili jednego typu albo wszystkich konfigurowalnych. */
  async unsubscribe(userId: string, scope: UnsubscribeScope): Promise<NotificationType[]> {
    const types = (scope === 'ALL' ? NOTIFICATION_TYPES : [scope]).filter(
      (type) => NOTIFICATION_EMAIL[type].configurable,
    );
    await this.save(
      userId,
      types.map((type) => ({ type, enabled: false })),
    );
    return types;
  }

  /** Czy wysłać e-mail danego typu. */
  async emailEnabled(userId: string, type: NotificationType, tx?: Transaction): Promise<boolean> {
    if (!NOTIFICATION_EMAIL[type].configurable) {
      return true;
    }
    const [row] = await (tx ?? this.db)
      .select({ enabled: notificationPreferences.enabled })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.type, type),
          eq(notificationPreferences.channel, 'EMAIL'),
        ),
      );
    return emailEnabled(type, row?.enabled);
  }

  private async save(
    userId: string,
    entries: readonly { type: NotificationType; enabled: boolean }[],
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.db
      .insert(notificationPreferences)
      .values(entries.map((entry) => ({ userId, channel: 'EMAIL' as const, ...entry })))
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.type,
          notificationPreferences.channel,
        ],
        set: { enabled: sql`excluded.enabled`, updatedAt: new Date() },
      });
  }

  private async stored(userId: string): Promise<Map<NotificationType, boolean>> {
    const rows = await this.db
      .select({ type: notificationPreferences.type, enabled: notificationPreferences.enabled })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.channel, 'EMAIL'),
        ),
      );
    return new Map(rows.map((row) => [row.type, row.enabled]));
  }
}

function emailEnabled(type: NotificationType, stored: boolean | undefined): boolean {
  const rule = NOTIFICATION_EMAIL[type];
  return rule.configurable ? (stored ?? rule.enabledByDefault) : true;
}
