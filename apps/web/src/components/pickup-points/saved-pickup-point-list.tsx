'use client';

import {
  getGetMyPickupPointsQueryKey,
  type SavedPickupPointDto,
  useDeletePickupPoint,
  useUpdatePickupPoint,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { FormAlert, useErrorMessage } from '@/components/auth/form-parts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Zapisane punkty odbioru w koncie (F-64): usługa, punkt, adres i etykieta domyślnego punktu
 * usługi; ustawienie domyślnego i usunięcie z potwierdzeniem. Po zmianie strona (SSR) odświeża
 * listę.
 */
export function SavedPickupPointList({
  points,
  carrierNames,
  canAdd,
}: {
  readonly points: readonly SavedPickupPointDto[];
  /** Nazwy usług po identyfikatorze, np. „InPost Paczkomat 24/7”. */
  readonly carrierNames: Readonly<Record<string, string>>;
  readonly canAdd: boolean;
}) {
  const t = useTranslations('addresses.points');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const update = useUpdatePickupPoint();
  const remove = useDeletePickupPoint();
  const [error, setError] = useState<string>();
  const pending = update.isPending || remove.isPending;

  const run = async (action: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: getGetMyPickupPointsQueryKey() });
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <div className="space-y-4">
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <ul className="grid gap-4 sm:grid-cols-2" aria-label={t('title')}>
        {points.map((point) => {
          const carrier = carrierNames[point.carrierId] ?? point.carrierId;
          return (
            <li
              key={point.id}
              className={cn(
                'flex flex-col rounded-xl border bg-card p-5',
                point.isDefault ? 'border-violet-400 ring-1 ring-violet-400' : 'border-border',
              )}
            >
              <div className="mb-3 flex flex-wrap gap-2">
                {point.isDefault ? (
                  <Chip tone="brand-outline" shape="pill">
                    {t('defaultFor', { carrier })}
                  </Chip>
                ) : (
                  <Chip shape="pill">{carrier}</Chip>
                )}
              </div>
              <div className="mb-4 flex min-w-0 items-start gap-2.5 text-body text-foreground-secondary">
                <MapPin aria-hidden className="mt-1 size-4.5 shrink-0 text-violet-700" />
                <p className="min-w-0 break-words">
                  <span className="block text-title font-extrabold text-foreground">
                    {point.name}
                  </span>
                  <span className="block">{point.address}</span>
                  {point.openingHours === null ? null : (
                    <span className="block text-muted-foreground">{point.openingHours}</span>
                  )}
                </p>
              </div>
              <div className="mt-auto flex flex-wrap gap-1 border-t border-ink-100 pt-3">
                {point.isDefault ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-link"
                    disabled={pending}
                    onClick={() =>
                      void run(() =>
                        update.mutateAsync({ id: point.id, data: { isDefault: true } }),
                      )
                    }
                  >
                    {t('setDefault')}
                    <span className="sr-only">: {point.name}</span>
                  </Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive-soft"
                      disabled={pending}
                    >
                      {t('delete')}
                      <span className="sr-only">: {point.name}</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('deleteText', { name: point.name })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                      <AlertDialogAction
                        className={buttonVariants({ variant: 'destructive' })}
                        onClick={() => void run(() => remove.mutateAsync({ id: point.id }))}
                      >
                        {t('deleteConfirm')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </li>
          );
        })}
        {canAdd ? (
          <li className="flex">
            <Link
              href={routes.newPickupPoint}
              className="flex min-h-44 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-brand-border bg-accent text-label-lg text-accent-foreground outline-none transition-colors duration-150 hover:bg-violet-100 focus-visible:shadow-focus-ring motion-reduce:transition-none"
            >
              <Plus aria-hidden className="size-7" />
              {t('add')}
            </Link>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
