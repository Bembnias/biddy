'use client';

// Akcje stron w sporze (F-28, PROJECT.md §7.5): odpowiedź sprzedającego (zwrot z odesłaniem albo
// bez, propozycja zwrotu części ceny, odrzucenie), odpowiedź kupującego na propozycję, weryfikacja
// zwrotu i wyjaśnienia. Wynik akcji (DisputeDto) zastępuje widok sporu, a zamówienie odświeżamy,
// bo rozstrzygnięcie zmienia jego stan. Błąd pokazuje `role="alert"` przy akcji.
import {
  type DisputeDto,
  answerDisputeOffer,
  commentOnDispute,
  getGetOrderDisputeQueryKey,
  getGetOrderQueryKey,
  respondToDispute,
  reviewDisputeReturn,
} from '@biddy/api-client';
import { DISPUTE_TEXT_LIMITS, formatMoney, MAX_DISPUTE_PHOTOS, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { track } from '@/analytics/posthog';
import { FieldErrorText, useErrorMessage } from '@/components/auth/form-parts';
import { PhotoUploader } from '@/components/media/photo-uploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { parseOfferAmount } from '@/lib/disputes/dispute-view';
import { cn } from '@/lib/utils';

const zl = (amount: number, currency: DisputeDto['currency']) =>
  formatMoney(money(amount, currency), { trailingZeroDisplay: 'stripIfInteger' });

/** Akcja sporu: wynik zastępuje widok sporu, a zamówienie odświeża się w tle. */
function useDisputeAction(orderPublicId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (action: () => Promise<DisputeDto>): Promise<boolean> => {
    setSending(true);
    setError(undefined);
    try {
      const dispute = await action();
      queryClient.setQueryData(getGetOrderDisputeQueryKey(orderPublicId), dispute);
      void queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderPublicId) });
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setSending(false);
    }
  };
  return { sending, error, run };
}

function ActionError({ message }: { readonly message: string | undefined }) {
  return message === undefined ? null : (
    <p role="alert" className="text-body-sm font-semibold text-destructive">
      {message}
    </p>
  );
}

/** Pole tekstowe notatki z etykietą, podpowiedzią i błędem. */
function NoteField({
  label,
  hint,
  error,
  value,
  onChange,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  const describedBy = [
    hint === undefined ? null : `${id}-hint`,
    error === undefined ? null : `${id}-error`,
  ]
    .filter((part) => part !== null)
    .join(' ');
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        maxLength={DISPUTE_TEXT_LIMITS.note.max}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-body-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error === undefined ? null : <FieldErrorText id={`${id}-error`}>{error}</FieldErrorText>}
    </div>
  );
}

type SellerChoice = 'ACCEPT' | 'OFFER_PARTIAL' | 'REJECT';

/** Odpowiedź sprzedającego w 48 h: trzy możliwości, każda z własnym formularzem w karcie. */
export function SellerResponse({ dispute }: { readonly dispute: DisputeDto }) {
  const t = useTranslations('dispute.respond');
  const groupId = useId();
  const action = useDisputeAction(dispute.orderPublicId);
  const [choice, setChoice] = useState<SellerChoice>('ACCEPT');
  const [withReturn, setWithReturn] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [fieldError, setFieldError] = useState<string>();
  const max = zl(dispute.itemsTotal, dispute.currency);
  const quote = dispute.returnQuote;

  const submit = async () => {
    setFieldError(undefined);
    const trimmed = note.trim();
    if (choice === 'OFFER_PARTIAL') {
      const amount = parseOfferAmount(amountText, dispute.itemsTotal);
      if (typeof amount !== 'number') {
        setFieldError(amount === 'tooHigh' ? t('amountTooHigh', { max }) : t('amountInvalid'));
        return;
      }
      const sent = await action.run(() =>
        respondToDispute(dispute.id, {
          action: 'OFFER_PARTIAL',
          amount,
          ...(trimmed === '' ? {} : { note: trimmed }),
        }),
      );
      if (sent) {
        track('dispute_seller_responded', { action: 'OFFER_PARTIAL', withReturn: false });
      }
      return;
    }
    if (choice === 'REJECT') {
      if (trimmed.length < DISPUTE_TEXT_LIMITS.explanation.min) {
        setFieldError(t('explanationShort', { min: DISPUTE_TEXT_LIMITS.explanation.min }));
        return;
      }
      const sent = await action.run(() =>
        respondToDispute(dispute.id, { action: 'REJECT', note: trimmed, mediaIds: photos }),
      );
      if (sent) {
        track('dispute_seller_responded', { action: 'REJECT', withReturn: false });
      }
      return;
    }
    const sent = await action.run(() =>
      respondToDispute(dispute.id, {
        action: 'ACCEPT',
        returnRequired: withReturn,
        ...(trimmed === '' ? {} : { note: trimmed }),
      }),
    );
    if (sent) {
      track('dispute_seller_responded', { action: 'ACCEPT', withReturn });
    }
  };

  const choices: readonly { readonly value: SellerChoice; readonly hint: string }[] = [
    {
      value: 'ACCEPT',
      hint: t('acceptHint', { amount: zl(dispute.orderTotal, dispute.currency) }),
    },
    { value: 'OFFER_PARTIAL', hint: t('offerHint', { max }) },
    { value: 'REJECT', hint: t('rejectHint') },
  ];

  return (
    <div className="space-y-5">
      <fieldset className="min-w-0 space-y-3">
        <legend className="mb-3 text-title">{t('title')}</legend>
        {choices.map((option) => (
          <label
            key={option.value}
            htmlFor={`${groupId}-${option.value}`}
            className={cn(
              'flex cursor-pointer items-start gap-3.5 rounded-xl border border-border-strong px-4 py-3.5 transition-[border-color,box-shadow,background-color] duration-150 has-[:focus-visible]:shadow-focus-ring motion-reduce:transition-none',
              choice === option.value && 'border-brand bg-violet-50 ring-1 ring-brand',
            )}
          >
            <input
              id={`${groupId}-${option.value}`}
              type="radio"
              name={`${groupId}-choice`}
              value={option.value}
              checked={choice === option.value}
              onChange={() => {
                setChoice(option.value);
                setFieldError(undefined);
              }}
              className="mt-0.5 size-5 shrink-0 accent-brand"
            />
            <span className="flex flex-col text-title">
              {t(option.value)}
              <span className="text-body-sm text-muted-foreground">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {choice === 'ACCEPT' ? (
        <fieldset className="min-w-0 space-y-2.5 rounded-xl bg-canvas p-4">
          <legend className="sr-only">{t('returnLegend')}</legend>
          <label className="flex items-start gap-3 text-body">
            <input
              type="radio"
              name={`${groupId}-return`}
              checked={!withReturn}
              onChange={() => {
                setWithReturn(false);
              }}
              className="mt-1 size-4 shrink-0 accent-brand"
            />
            {t('withoutReturn')}
          </label>
          <label className="flex items-start gap-3 text-body">
            <input
              type="radio"
              name={`${groupId}-return`}
              checked={withReturn}
              disabled={quote === null}
              onChange={() => {
                setWithReturn(true);
              }}
              className="mt-1 size-4 shrink-0 accent-brand"
            />
            <span className="flex flex-col">
              {t('withReturn')}
              <span className="text-body-sm text-muted-foreground">
                {quote === null
                  ? t('returnUnavailable')
                  : t('withReturnHint', {
                      carrier: quote.name,
                      price: zl(quote.price, dispute.currency),
                    })}
              </span>
            </span>
          </label>
        </fieldset>
      ) : null}

      {choice === 'OFFER_PARTIAL' ? (
        <div className="max-w-xs space-y-2">
          <Label htmlFor={`${groupId}-amount`}>{t('amount')}</Label>
          <Input
            id={`${groupId}-amount`}
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            aria-invalid={fieldError === undefined ? undefined : true}
            aria-describedby={fieldError === undefined ? undefined : `${groupId}-amount-error`}
            onChange={(event) => {
              setAmountText(event.target.value);
            }}
          />
          {fieldError === undefined ? null : (
            <FieldErrorText id={`${groupId}-amount-error`}>{fieldError}</FieldErrorText>
          )}
        </div>
      ) : null}

      <NoteField
        label={choice === 'REJECT' ? t('explanation') : t('note')}
        {...(choice === 'REJECT'
          ? { hint: t('explanationHint', { min: DISPUTE_TEXT_LIMITS.explanation.min }) }
          : {})}
        error={choice === 'REJECT' ? fieldError : undefined}
        value={note}
        onChange={setNote}
      />
      {choice === 'REJECT' ? (
        <PhotoUploader
          purpose="DISPUTE_EVIDENCE"
          max={MAX_DISPUTE_PHOTOS}
          hint={t('photosHint')}
          onChange={setPhotos}
        />
      ) : null}

      <ActionError message={action.error} />
      <Button
        type="button"
        variant={choice === 'REJECT' ? 'outline' : 'cta'}
        disabled={action.sending}
        onClick={() => void submit()}
      >
        {action.sending
          ? t('sending')
          : choice === 'ACCEPT'
            ? t('confirmAccept', { amount: zl(dispute.orderTotal, dispute.currency) })
            : choice === 'OFFER_PARTIAL'
              ? t('confirmOffer')
              : t('confirmReject')}
      </Button>
    </div>
  );
}

/** Odpowiedź kupującego na propozycję zwrotu części ceny. */
export function OfferAnswer({ dispute }: { readonly dispute: DisputeDto }) {
  const t = useTranslations('dispute.offer');
  const action = useDisputeAction(dispute.orderPublicId);
  const amount = zl(dispute.partialOffer ?? 0, dispute.currency);
  const answer = async (accept: boolean) => {
    if (await action.run(() => answerDisputeOffer(dispute.id, { accept }))) {
      track('dispute_offer_answered', { accepted: accept });
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="cta"
          disabled={action.sending}
          onClick={() => void answer(true)}
        >
          {t('accept', { amount })}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={action.sending}
          onClick={() => void answer(false)}
        >
          {t('reject')}
        </Button>
      </div>
      <ActionError message={action.error} />
    </div>
  );
}

/** Weryfikacja zwrotu przez sprzedającego: przyjęcie albo problem ze zwrotem (do Biddy). */
export function ReturnReview({ dispute }: { readonly dispute: DisputeDto }) {
  const t = useTranslations('dispute.review');
  const action = useDisputeAction(dispute.orderPublicId);
  const [contesting, setContesting] = useState(false);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [fieldError, setFieldError] = useState<string>();
  const accept = async () => {
    if (await action.run(() => reviewDisputeReturn(dispute.id, { accept: true }))) {
      track('dispute_return_reviewed', { accepted: true });
    }
  };
  const contest = async () => {
    const trimmed = note.trim();
    if (trimmed.length < DISPUTE_TEXT_LIMITS.explanation.min) {
      setFieldError(t('noteShort', { min: DISPUTE_TEXT_LIMITS.explanation.min }));
      return;
    }
    setFieldError(undefined);
    const sent = await action.run(() =>
      reviewDisputeReturn(dispute.id, { accept: false, note: trimmed, mediaIds: photos }),
    );
    if (sent) {
      track('dispute_return_reviewed', { accepted: false });
    }
  };
  if (!contesting) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="cta"
            disabled={action.sending}
            onClick={() => void accept()}
          >
            {t('accept')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setContesting(true);
            }}
          >
            {t('contest')}
          </Button>
        </div>
        <ActionError message={action.error} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <NoteField
        label={t('note')}
        hint={t('contestHint', { min: DISPUTE_TEXT_LIMITS.explanation.min })}
        error={fieldError}
        value={note}
        onChange={setNote}
      />
      <PhotoUploader
        purpose="DISPUTE_EVIDENCE"
        max={MAX_DISPUTE_PHOTOS}
        hint={t('photosHint')}
        onChange={setPhotos}
      />
      <ActionError message={action.error} />
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="cta"
          disabled={action.sending}
          onClick={() => void contest()}
        >
          {t('confirmContest')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={action.sending}
          onClick={() => {
            setContesting(false);
          }}
        >
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Wyjaśnienie strony (notatka i zdjęcia) przed rozstrzygnięciem. */
export function DisputeComment({ dispute }: { readonly dispute: DisputeDto }) {
  const t = useTranslations('dispute.comment');
  const titleId = useId();
  const action = useDisputeAction(dispute.orderPublicId);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  // Nowy uploader po dodaniu wyjaśnienia (czyste pole zdjęć).
  const [round, setRound] = useState(0);
  const [added, setAdded] = useState(false);
  const submit = async () => {
    const trimmed = note.trim();
    if (trimmed === '') {
      return;
    }
    setAdded(false);
    const sent = await action.run(() =>
      commentOnDispute(dispute.id, { note: trimmed, mediaIds: photos }),
    );
    if (sent) {
      track('dispute_comment_added', { role: dispute.role });
      setNote('');
      setPhotos([]);
      setRound((current) => current + 1);
      setAdded(true);
    }
  };
  return (
    <section
      aria-labelledby={titleId}
      className="space-y-4 rounded-2xl border border-border bg-card p-5.5 sm:p-7"
    >
      <h2 id={titleId} className="text-h3">
        {t('title')}
      </h2>
      <NoteField label={t('note')} hint={t('hint')} value={note} onChange={setNote} />
      <PhotoUploader
        key={round}
        purpose="DISPUTE_EVIDENCE"
        max={MAX_DISPUTE_PHOTOS}
        hint={t('photosHint')}
        onChange={setPhotos}
      />
      <ActionError message={action.error} />
      <div role="status">
        {added ? <p className="text-body-sm text-foreground-secondary">{t('added')}</p> : null}
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={action.sending || note.trim() === ''}
        onClick={() => void submit()}
      >
        {action.sending ? t('sending') : t('submit')}
      </Button>
    </section>
  );
}
