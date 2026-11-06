// Zgłoszenia DSA (notice & action, F-29): zapis z migawką treści, którą zgłaszający przekazuje do
// sprawdzenia, i event ReportCreated. Jedno zgłoszenie celu na osobę: ponowienie zwraca istniejące.
// Kolejka moderacji, decyzje z uzasadnieniem i zgłoszenia aukcji: F-35.
import type { ReportReason } from '@biddy/shared';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import type { Transaction } from '../../../infra/db/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import {
  type ReportContext,
  type ReportRow,
  type ReportTargetType,
  reports,
} from '../db/trust-safety.schema.js';
import { ReportCreated } from '../trust-safety.events.js';

export interface CreateReportInput {
  readonly reporterId: string;
  readonly targetType: ReportTargetType;
  readonly targetId: string;
  readonly reason: ReportReason;
  readonly details: string | null;
  readonly context: ReportContext;
}

@Injectable()
export class ReportService {
  constructor(private readonly outbox: Outbox) {}

  /** Zgłoszenie w transakcji wywołującego; `created` = false, gdy ta osoba już zgłosiła ten cel. */
  async create(
    tx: Transaction,
    input: CreateReportInput,
  ): Promise<{ readonly report: ReportRow; readonly created: boolean }> {
    const [inserted] = await tx
      .insert(reports)
      .values({
        reporterId: input.reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        details: input.details,
        context: input.context,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted !== undefined) {
      await this.outbox.add(
        tx,
        ReportCreated.create({
          aggregateId: inserted.id,
          payload: {
            reporterId: inserted.reporterId,
            targetType: inserted.targetType,
            targetId: inserted.targetId,
            reason: inserted.reason,
          },
        }),
      );
      return { report: inserted, created: true };
    }
    const [existing] = await tx
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, input.reporterId),
          eq(reports.targetType, input.targetType),
          eq(reports.targetId, input.targetId),
        ),
      );
    if (existing === undefined) {
      throw new Error('Zgłoszenie zniknęło po konflikcie unikalności');
    }
    return { report: existing, created: false };
  }
}
