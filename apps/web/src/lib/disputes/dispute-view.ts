// Widok sporu (F-28) bez Reacta: ton stanu, termin dla bieżącego kroku, schemat formularza
// zgłoszenia i kwoty propozycji. Strona sporu i testy liczą to samo.
import type { DisputeDto } from '@biddy/api-client';
import {
  DISPUTE_REASONS,
  DISPUTE_TEXT_LIMITS,
  disputeReasonRequiresPhoto,
  MAX_DISPUTE_PHOTOS,
} from '@biddy/shared';
import { z } from 'zod';

import { parsePayoutAmount } from '@/lib/payouts/payout-view';

export type DisputeStatus = DisputeDto['status'];

/** Ton pigułki stanu sporu (Badge). */
export const DISPUTE_TONES: Readonly<
  Record<DisputeStatus, 'warning' | 'info' | 'success' | 'neutral'>
> = {
  AWAITING_SELLER: 'warning',
  PARTIAL_OFFERED: 'warning',
  ESCALATED: 'info',
  AWAITING_RETURN: 'warning',
  RETURN_IN_TRANSIT: 'info',
  RETURN_DELIVERED: 'info',
  RESOLVED: 'success',
};

/** Termin bieżącego kroku sporu (do zdania „do …”) albo null. */
export function disputeDeadline(dispute: DisputeDto): string | null {
  switch (dispute.status) {
    case 'AWAITING_SELLER':
    case 'PARTIAL_OFFERED':
      return dispute.responseDueAt;
    case 'ESCALATED':
      return dispute.decisionDueAt;
    case 'AWAITING_RETURN':
      return dispute.return?.shipBy ?? null;
    case 'RETURN_DELIVERED':
      return dispute.return?.inspectionEndsAt ?? null;
    case 'RETURN_IN_TRANSIT':
    case 'RESOLVED':
      return null;
  }
}

/** Komunikaty walidacji formularza zgłoszenia (`dispute.form.validation`). */
export type DisputeFormMessages = (
  key: 'reason' | 'descriptionShort' | 'descriptionLong' | 'photoRequired' | 'photosLimit',
) => string;

/** Zgłoszenie problemu: reguły jak `OpenDisputeBody` w API (zdjęcie wymagane przy wadach). */
export function disputeFormSchema(t: DisputeFormMessages) {
  return z
    .object({
      reason: z.enum(DISPUTE_REASONS, { error: t('reason') }),
      description: z
        .string()
        .trim()
        .min(DISPUTE_TEXT_LIMITS.description.min, t('descriptionShort'))
        .max(DISPUTE_TEXT_LIMITS.description.max, t('descriptionLong')),
      mediaIds: z.array(z.string()).max(MAX_DISPUTE_PHOTOS, t('photosLimit')),
    })
    .superRefine((value, context) => {
      if (disputeReasonRequiresPhoto(value.reason) && value.mediaIds.length === 0) {
        context.addIssue({ code: 'custom', path: ['mediaIds'], message: t('photoRequired') });
      }
    });
}

/** Kwota propozycji zwrotu: grosze, 'empty', 'invalid' albo 'tooHigh' (ponad cenę). */
export function parseOfferAmount(
  text: string,
  max: number,
): number | 'empty' | 'invalid' | 'tooHigh' {
  const parsed = parsePayoutAmount(text);
  return typeof parsed === 'number' && parsed > max ? 'tooHigh' : parsed;
}
