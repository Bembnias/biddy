'use client';

// Kreator aukcji (F-14): 6 kroków z krokiem w adresie (`?krok=`), autozapis szkicu, walidacja
// kroku przy „Dalej” tymi samymi regułami co API (`validateListing`) i publikacja. Aukcja
// opublikowana bez ofert przechodzi przez te same kroki, a zmiany zapisuje przycisk w podglądzie.
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
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
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

import { CategoryStep, DetailsStep, PhotosStep, PricingStep, ShippingStep } from './listing-steps';
import { ReviewStep } from './review-step';

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
  const [alert, setAlert] = useState<string>();

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
    setAlert(undefined);
    setServerIssues(undefined);
    try {
      if (!draft) {
        // Aukcja bez ofert: zapis zmian z pełną walidacją po stronie API.
        const saved = await autosave.flush();
        if (!saved) {
          const issues = problemIssues(autosave.error);
          setServerIssues(issues);
          showIssues(issues.filter((issue) => stepOfPath(issue.path) === 'podglad'));
          setAlert(problemDetail(autosave.error, review('publishError')));
          return;
        }
        setAlert(review('changesSaved'));
        return;
      }
      if (limits.data !== undefined && !limits.data.kycNoticeAccepted && !kycAccepted) {
        showIssues([{ path: 'kycNoticeAccepted', message: review('kycRequired') }]);
        return;
      }
      if (!(await autosave.flush())) {
        setAlert(problemDetail(autosave.error, t('saveError')));
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
      setAlert(problemDetail(error, review('publishError')));
    } finally {
      setBusy(false);
    }
  };

  if (!initial.editable) {
    return (
      <div className="space-y-4">
        <p>{t('notEditable')}</p>
        <Button asChild variant="outline">
          <Link href={routes.myAuctions}>{t('toMyAuctions')}</Link>
        </Button>
      </div>
    );
  }

  const saveText =
    autosave.state === 'saving'
      ? t('saving')
      : autosave.state === 'saved'
        ? t('saved')
        : autosave.state === 'error'
          ? t('saveError')
          : '';
  const minPhotos =
    category?.isBrandSensitive === true
      ? LISTING_RULES.brandSensitivePhotosMin
      : LISTING_RULES.photosMin;

  return (
    <FormProvider {...form}>
      <form
        noValidate
        className="space-y-8"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label={t('progress')}>
            <ol className="flex flex-wrap gap-2">
              {LISTING_STEPS.map((candidate, position) => (
                <li key={candidate.id}>
                  <Link
                    href={stepHref(candidate.id)}
                    scroll={false}
                    aria-current={candidate.id === step ? 'step' : undefined}
                    onClick={() => {
                      if (draft) {
                        void autosave.flush();
                      }
                    }}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm',
                      candidate.id === step
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <span aria-hidden>{position + 1}</span>
                    {t(`steps.${candidate.id}`)}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
          <p role="status" className="text-sm text-muted-foreground">
            {saveText}
          </p>
        </div>

        <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
          {t('stepOf', {
            current: index + 1,
            total: LISTING_STEPS.length,
            name: t(`steps.${step}`),
          })}
        </h2>
        {stepAlert ? (
          <p role="alert" className="text-sm text-destructive">
            {t('stepErrors')}
          </p>
        ) : null}

        <section hidden={step !== 'zdjecia'}>
          <PhotosStep listing={listing} minPhotos={minPhotos} />
        </section>
        <section hidden={step !== 'kategoria'}>
          <CategoryStep schema={category} />
        </section>
        <section hidden={step !== 'opis'}>
          <DetailsStep />
        </section>
        <section hidden={step !== 'dostawa'}>
          <ShippingStep
            carriers={carriers.data}
            carriersError={carriers.isError}
            onRetry={() => void carriers.refetch()}
          />
        </section>
        <section hidden={step !== 'cena'}>
          <PricingStep maxAuctionValue={limits.data?.maxAuctionValue} durationLocked={!draft} />
        </section>
        <section hidden={step !== 'podglad'}>
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
            busy={busy}
            alert={alert}
            onSubmit={() => void submit()}
            stepHref={stepHref}
            returnTo={listingWizardUrl(initial.id, 'podglad')}
          />
        </section>

        <div className="flex justify-between gap-3 border-t border-border pt-6">
          {index > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={() => {
                const previous = LISTING_STEPS[index - 1];
                if (previous !== undefined) {
                  goTo(previous.id);
                }
              }}
            >
              {t('back')}
            </Button>
          ) : (
            <span />
          )}
          {index < LISTING_STEPS.length - 1 ? (
            <Button type="button" className="h-10" onClick={next}>
              {t('next')}
            </Button>
          ) : null}
        </div>
      </form>
    </FormProvider>
  );
}
