'use client';

// Kreator aukcji (F-14, układ F-63): 6 kroków z krokiem w adresie (`?krok=`), autozapis szkicu,
// walidacja kroku przy „Dalej” tymi samymi regułami co API (`validateListing`) i publikacja.
// Aukcja opublikowana bez ofert przechodzi przez te same kroki, a zmiany zapisuje przycisk
// w podglądzie. Od 1024 px obok formularza podgląd karty z listą kroków (D5).
import {
  type ListingDto,
  isApiError,
  publishAuction,
  useGetCarriers,
  useGetCategorySchema,
  useGetSellingLimits,
} from '@biddy/api-client';
import {
  LISTING_RULES,
  type ListingContext,
  type ListingIssue,
  validateListing,
} from '@biddy/shared';
import { ArrowLeft, ArrowRight, Check, Send } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactNode, type Ref, useEffect, useRef, useState } from 'react';
import { type FieldPath, FormProvider, useForm, useWatch } from 'react-hook-form';

import { track } from '@/analytics/posthog';
import { Button } from '@/components/ui/button';
import {
  convert,
  formPath,
  formValuesFrom,
  isListingStep,
  LISTING_STEPS,
  type ListingFormValues,
  type ListingStepId,
  mergeIssues,
  stepOfPath,
} from '@/lib/listing/form';
import { useListingAutosave } from '@/lib/listing/use-listing-autosave';
import { listingWizardUrl, routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

import { ListingPreview } from './listing-preview';
import { CategoryStep, DetailsStep, PhotosStep, PricingStep, ShippingStep } from './listing-steps';
import { type ReviewNotice, ReviewStep } from './review-step';

/** Komunikat błędu z odpowiedzi API (Problem Details) albo ogólny. */
function problemDetail(error: unknown, fallback: string): string {
  return isApiError(error) && error.problem !== undefined ? error.problem.detail : fallback;
}

/** Błędy pól z odpowiedzi API (400 VALIDATION_FAILED) na ścieżkach formularza. */
function problemIssues(error: unknown): ListingIssue[] {
  if (!isApiError(error) || error.problem?.code !== 'VALIDATION_FAILED') {
    return [];
  }
  return (error.problem.errors ?? []).map((issue) => ({
    path: formPath(issue.path),
    message: issue.message,
  }));
}

export function ListingWizard({
  initial,
  phoneVerified,
}: {
  readonly initial: ListingDto;
  readonly phoneVerified: boolean;
}) {
  const t = useTranslations('listing.wizard');
  const review = useTranslations('listing.review');
  const photosText = useTranslations('listing.photos');
  const categoryText = useTranslations('listing.category');
  const detailsText = useTranslations('listing.details');
  const shippingText = useTranslations('listing.shipping');
  const pricingText = useTranslations('listing.pricing');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get('krok');
  const step: ListingStepId = isListingStep(requested) ? requested : 'zdjecia';
  const index = LISTING_STEPS.findIndex((candidate) => candidate.id === step);
  const draft = initial.status === 'DRAFT';

  const form = useForm<ListingFormValues>({ defaultValues: formValuesFrom(initial) });
  const [listing, setListing] = useState(initial);
  const autosave = useListingAutosave({
    form,
    auctionId: initial.id,
    initial,
    enabled: draft && initial.editable,
    onSaved: setListing,
  });

  const categoryId = useWatch({ control: form.control, name: 'categoryId' });
  const schema = useGetCategorySchema(categoryId, {
    query: { enabled: categoryId !== '', staleTime: 5 * 60_000, retry: false },
  });
  const carriers = useGetCarriers({ query: { staleTime: 5 * 60_000 } });
  const limits = useGetSellingLimits();
  const category = categoryId === '' ? undefined : schema.data;
  const contextReady = (categoryId === '' || !schema.isPending) && carriers.isSuccess;
  const context: ListingContext = {
    category,
    carriers: carriers.data ?? [],
    limits:
      limits.data === undefined
        ? undefined
        : { maxAuctionValue: limits.data.maxAuctionValue, kycVerified: limits.data.kycVerified },
  };

  const [stepAlert, setStepAlert] = useState(false);
  const [serverIssues, setServerIssues] = useState<readonly ListingIssue[] | undefined>();
  const [kycAccepted, setKycAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ReviewNotice>();

  const issuesNow = (): ListingIssue[] => {
    const { input, formatIssues } = convert(form.getValues());
    return mergeIssues(formatIssues, validateListing(input, context));
  };
  // Subskrypcja całego formularza: lista braków w podglądzie odświeża się z każdą zmianą.
  useWatch({ control: form.control });
  const liveIssues = contextReady ? issuesNow() : [];

  // Zmiana pola usuwa jego błąd (nowa wartość zostanie sprawdzona przy „Dalej” albo publikacji).
  useEffect(
    () =>
      form.subscribe({
        formState: { values: true },
        callback: ({ name }) => {
          if (name !== undefined) {
            form.clearErrors(name as FieldPath<ListingFormValues>);
            if (name === 'packageSize') {
              form.clearErrors('allowedCarriers');
            }
          }
        },
      }),
    [form],
  );

  // Fokus na nagłówku kroku po jego zmianie (czytnik ekranu ogłasza nowy krok).
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const stepHref = (target: ListingStepId) => `${pathname}?krok=${target}`;
  const goTo = (target: ListingStepId) => {
    setStepAlert(false);
    if (draft) {
      void autosave.flush();
    }
    router.push(stepHref(target), { scroll: false });
  };

  const showIssues = (issues: readonly ListingIssue[]) => {
    issues.forEach((issue, position) => {
      form.setError(
        issue.path as FieldPath<ListingFormValues>,
        { type: 'listing', message: issue.message },
        { shouldFocus: position === 0 },
      );
    });
  };

  const next = () => {
    const current = LISTING_STEPS[index];
    const following = LISTING_STEPS[index + 1];
    if (current === undefined || following === undefined) {
      return;
    }
    const stepIssues = contextReady
      ? issuesNow().filter((issue) => stepOfPath(issue.path) === current.id)
      : [];
    form.clearErrors();
    if (stepIssues.length > 0) {
      showIssues(stepIssues);
      setStepAlert(true);
      return;
    }
    track('listing_step_completed', { step: current.id });
    goTo(following.id);
  };

  const submit = async () => {
    setBusy(true);
    setNotice(undefined);
    setServerIssues(undefined);
    try {
      if (!draft) {
        // Aukcja bez ofert: zapis zmian z pełną walidacją po stronie API.
        const saved = await autosave.flush();
        if (!saved) {
          const issues = problemIssues(autosave.error);
          setServerIssues(issues);
          showIssues(issues.filter((issue) => stepOfPath(issue.path) === 'podglad'));
          setNotice({ tone: 'error', text: problemDetail(autosave.error, review('publishError')) });
          return;
        }
        setNotice({ tone: 'success', text: review('changesSaved') });
        return;
      }
      if (limits.data !== undefined && !limits.data.kycNoticeAccepted && !kycAccepted) {
        showIssues([{ path: 'kycNoticeAccepted', message: review('kycRequired') }]);
        return;
      }
      if (!(await autosave.flush())) {
        setNotice({ tone: 'error', text: problemDetail(autosave.error, t('saveError')) });
        return;
      }
      const published = await publishAuction(initial.id, {
        ...(kycAccepted ? { kycNoticeAccepted: true } : {}),
      });
      track('listing_published', {
        categoryId: published.categoryId,
        durationDays: published.durationDays,
        hasBuyNow: published.buyNowPrice !== null,
        hasReserve: published.reservePrice !== null,
        status: published.status,
      });
      router.push(`${routes.myAuctions}?opublikowano=${published.id}`);
    } catch (error) {
      const issues = problemIssues(error);
      track('listing_publish_failed', {
        codes: isApiError(error) ? [error.problem?.code ?? String(error.status)] : ['NETWORK'],
      });
      if (issues.length > 0) {
        setServerIssues(issues);
        showIssues(issues.filter((issue) => issue.path === 'kycNoticeAccepted'));
      }
      setNotice({ tone: 'error', text: problemDetail(error, review('publishError')) });
    } finally {
      setBusy(false);
    }
  };

  const saveText =
    autosave.state === 'saving'
      ? t('saving')
      : autosave.state === 'saved'
        ? t('saved')
        : autosave.state === 'error'
          ? t('saveError')
          : '';
  const closeHref = draft ? routes.sell : routes.myAuctions;
  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {initial.editable ? (
          <p aria-hidden className="text-overline text-violet-700 uppercase">
            {t('stepShort', { current: index + 1, total: LISTING_STEPS.length })}
          </p>
        ) : null}
        <h1 className="text-h2 md:text-h1">
          {step === 'podglad' && initial.editable
            ? review('title')
            : draft
              ? t('title')
              : t('editTitle')}
        </h1>
      </div>
      {initial.editable ? (
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row-reverse sm:items-center sm:gap-3">
          <Button asChild variant="ghost" className="-mr-3 sm:mr-0">
            <Link
              href={closeHref}
              onClick={() => {
                if (draft) {
                  void autosave.flush();
                }
              }}
            >
              {t('close')}
            </Link>
          </Button>
          <p role="status" className="text-body-sm text-muted-foreground">
            {saveText}
          </p>
        </div>
      ) : null}
    </div>
  );

  if (!initial.editable) {
    return (
      <div className="space-y-6">
        {header}
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-7">
          <p>{t('notEditable')}</p>
          <Button asChild variant="outline">
            <Link href={routes.myAuctions}>{t('toMyAuctions')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const minPhotos =
    category?.isBrandSensitive === true
      ? LISTING_RULES.brandSensitivePhotosMin
      : LISTING_RULES.photosMin;
  // Kroki bez braków: ✓ w pasku kroków i na liście obok podglądu.
  const completed = contextReady
    ? new Set(
        LISTING_STEPS.filter(
          (candidate) =>
            candidate.id !== 'podglad' &&
            !liveIssues.some((issue) => stepOfPath(issue.path) === candidate.id),
        ).map((candidate) => candidate.id),
      )
    : undefined;
  const canPublish = !draft || phoneVerified;

  const card = (id: ListingStepId, title: string, content: ReactNode) => (
    <section
      hidden={step !== id}
      aria-labelledby={`listing-step-${id}`}
      className="space-y-6 rounded-2xl border border-border bg-card p-5 sm:p-7"
    >
      <StepHeading id={`listing-step-${id}`} ref={step === id ? heading : undefined}>
        <span className="sr-only">
          {t('stepShort', { current: index + 1, total: LISTING_STEPS.length })}:{' '}
        </span>
        {title}
      </StepHeading>
      {content}
    </section>
  );

  return (
    <FormProvider {...form}>
      <form
        noValidate
        className="space-y-7"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        {header}
        <StepBar
          step={step}
          completed={completed}
          stepHref={stepHref}
          onNavigate={() => {
            if (draft) {
              void autosave.flush();
            }
          }}
        />

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_21.25rem]">
          <div className="min-w-0 space-y-6">
            {stepAlert ? (
              <p
                role="alert"
                className="rounded-lg bg-destructive-soft px-4 py-3 text-body-sm font-semibold text-destructive"
              >
                {t('stepErrors')}
              </p>
            ) : null}

            {card(
              'zdjecia',
              photosText('title'),
              <PhotosStep listing={listing} minPhotos={minPhotos} />,
            )}
            {card('kategoria', categoryText('title'), <CategoryStep schema={category} />)}
            {card('opis', detailsText('title'), <DetailsStep />)}
            {card(
              'dostawa',
              shippingText('title'),
              <ShippingStep
                carriers={carriers.data}
                carriersError={carriers.isError}
                onRetry={() => void carriers.refetch()}
              />,
            )}
            {card(
              'cena',
              pricingText('title'),
              <PricingStep
                maxAuctionValue={limits.data?.maxAuctionValue}
                durationLocked={!draft}
                endsAt={listing.endsAt}
              />,
            )}
            {card(
              'podglad',
              review('summary'),
              <ReviewStep
                listing={listing}
                issues={serverIssues ?? liveIssues}
                schema={category}
                carriers={carriers.data}
                limits={limits.data}
                phoneVerified={phoneVerified}
                kycAccepted={kycAccepted}
                onKycAcceptedChange={(accepted) => {
                  setKycAccepted(accepted);
                  form.clearErrors('kycNoticeAccepted' as FieldPath<ListingFormValues>);
                }}
                kycError={
                  (form.formState.errors as Record<string, { message?: string } | undefined>)[
                    'kycNoticeAccepted'
                  ]?.message
                }
                notice={notice}
                stepHref={stepHref}
                returnTo={listingWizardUrl(initial.id, 'podglad')}
              />,
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              {index > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    const previous = LISTING_STEPS[index - 1];
                    if (previous !== undefined) {
                      goTo(previous.id);
                    }
                  }}
                >
                  <ArrowLeft aria-hidden />
                  {t('back')}
                </Button>
              ) : draft ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={() => {
                    void autosave.flush().then(() => {
                      router.push(routes.sell);
                    });
                  }}
                >
                  {t('saveAndExit')}
                </Button>
              ) : (
                <span />
              )}
              {index < LISTING_STEPS.length - 1 ? (
                <Button type="button" size="lg" onClick={next}>
                  {t('next')}
                  <ArrowRight aria-hidden />
                </Button>
              ) : canPublish ? (
                <Button
                  type="button"
                  variant="cta"
                  size="lg"
                  className="w-full sm:w-auto sm:min-w-70"
                  disabled={busy}
                  onClick={() => void submit()}
                >
                  <Send aria-hidden />
                  {draft
                    ? busy
                      ? review('publishing')
                      : review('publish')
                    : busy
                      ? review('savingChanges')
                      : review('saveChanges')}
                </Button>
              ) : null}
            </div>
          </div>
          <ListingPreview
            listing={listing}
            values={form.getValues()}
            categoryName={category?.name}
            completed={completed}
          />
        </div>
      </form>
    </FormProvider>
  );
}

/** Nagłówek kroku: fokus po zmianie kroku, żeby czytnik ekranu ogłosił nowy krok. */
function StepHeading({
  id,
  ref,
  children,
}: {
  readonly id: string;
  readonly ref: Ref<HTMLHeadingElement> | undefined;
  readonly children: ReactNode;
}) {
  return (
    <h2 id={id} ref={ref} tabIndex={-1} className="text-h3 outline-none">
      {children}
    </h2>
  );
}

/**
 * Pasek kroków (F-63): kroki bez braków z ✓, bieżący w ramce marki, kolejne szare. Nazwy kroków
 * od 1024 px; od 640 px tylko bieżącego, węziej same numery (nazwy zostają dla czytnika).
 */
function StepBar({
  step,
  completed,
  stepHref,
  onNavigate,
}: {
  readonly step: ListingStepId;
  readonly completed: ReadonlySet<ListingStepId> | undefined;
  readonly stepHref: (step: ListingStepId) => string;
  readonly onNavigate: () => void;
}) {
  const t = useTranslations('listing.wizard');
  return (
    <nav aria-label={t('progress')}>
      <ol className="flex items-center gap-1.5 sm:gap-2.5">
        {LISTING_STEPS.map((candidate, position) => {
          const current = candidate.id === step;
          const done = !current && completed?.has(candidate.id) === true;
          const previousDone =
            completed?.has(LISTING_STEPS[position - 1]?.id ?? 'podglad') === true;
          return (
            <Fragment key={candidate.id}>
              {position === 0 ? null : (
                <li
                  aria-hidden
                  className={cn(
                    'h-0.5 min-w-3 flex-1 rounded-full',
                    previousDone ? 'bg-brand' : 'bg-border',
                  )}
                />
              )}
              <li>
                <Link
                  href={stepHref(candidate.id)}
                  scroll={false}
                  aria-current={current ? 'step' : undefined}
                  onClick={onNavigate}
                  className="flex items-center gap-2.5 rounded-full outline-none focus-visible:shadow-focus-ring"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full text-label font-extrabold tabular-nums',
                      current
                        ? 'border-2 border-brand bg-card text-violet-700'
                        : done
                          ? 'bg-brand text-primary-foreground'
                          : 'bg-muted text-foreground-secondary',
                    )}
                  >
                    {done ? <Check className="size-4" /> : position + 1}
                  </span>
                  <span
                    className={cn(
                      'text-label whitespace-nowrap',
                      current
                        ? 'sr-only font-extrabold text-violet-700 sm:not-sr-only'
                        : 'sr-only text-foreground-secondary lg:not-sr-only',
                    )}
                  >
                    {t(`steps.${candidate.id}`)}
                    {done ? <span className="sr-only">, {t('stepDone')}</span> : null}
                  </span>
                </Link>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
