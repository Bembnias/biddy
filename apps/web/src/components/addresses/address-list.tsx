'use client';

import {
  type AddressDto,
  getGetMyAddressesQueryKey,
  useDeleteAddress,
  useUpdateAddress,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { track } from '@/analytics/posthog';
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
import { Chip } from '@/components/ui/chip';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatPhoneNumber } from '@/lib/phone';
import { editAddressUrl, routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/** Jedna linia adresu do komunikatów, np. „ul. Długa 5, 00-950 Warszawa”. */
function addressLine(address: AddressDto): string {
  return `${address.street}, ${address.postalCode} ${address.city}`;
}

/**
 * Adresy z akcjami (F-10, siatka kart F-63; domyślny adres dostawy w obramowaniu marki): edycja, ustawienie domyślnego adresu dostawy i nadania, usunięcie
 * z potwierdzeniem. Po zmianie strona (SSR) odświeża listę.
 */
export function AddressList({
  addresses,
  canAdd,
}: {
  readonly addresses: readonly AddressDto[];
  /** Kafelek „Dodaj adres” na końcu siatki (poniżej limitu adresów). */
  readonly canAdd: boolean;
}) {
  const t = useTranslations('addresses');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const update = useUpdateAddress();
  const remove = useDeleteAddress();
  const [error, setError] = useState<string>();
  const pending = update.isPending || remove.isPending;

  const run = async (action: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: getGetMyAddressesQueryKey() });
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <div className="space-y-4">
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <ul className="grid gap-4 sm:grid-cols-2">
        {addresses.map((address) => (
          <li
            key={address.id}
            className={cn(
              'flex flex-col rounded-xl border bg-card p-5',
              address.isDefault ? 'border-violet-400 ring-1 ring-violet-400' : 'border-border',
            )}
          >
            {address.isDefault || address.isSenderDefault ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {address.isDefault ? (
                  <Chip tone="brand-outline" shape="pill">
                    {t('defaultDelivery')}
                  </Chip>
                ) : null}
                {address.isSenderDefault ? <Chip shape="pill">{t('defaultSender')}</Chip> : null}
              </div>
            ) : null}
            <address className="mb-4 text-body text-foreground-secondary not-italic">
              <p className="text-title font-extrabold text-foreground">{address.recipientName}</p>
              <p>{address.street}</p>
              <p>
                {address.postalCode} {address.city}
              </p>
              <p className="text-muted-foreground">{formatPhoneNumber(address.phone)}</p>
            </address>
            <div className="mt-auto flex flex-wrap gap-1 border-t border-ink-100 pt-3">
              <Button asChild variant="ghost" size="sm">
                <Link href={editAddressUrl(address.id)}>{t('edit')}</Link>
              </Button>
              {address.isDefault ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-link"
                  disabled={pending}
                  onClick={() =>
                    void run(() =>
                      update.mutateAsync({ id: address.id, data: { isDefault: true } }),
                    )
                  }
                >
                  {t('setDefault')}
                </Button>
              )}
              {address.isSenderDefault ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-link"
                  disabled={pending}
                  onClick={() =>
                    void run(() =>
                      update.mutateAsync({ id: address.id, data: { isSenderDefault: true } }),
                    )
                  }
                >
                  {t('setSenderDefault')}
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
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('deleteText', { address: addressLine(address) })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      className={buttonVariants({ variant: 'destructive' })}
                      onClick={() =>
                        void run(async () => {
                          await remove.mutateAsync({ id: address.id });
                          track('address_deleted');
                        })
                      }
                    >
                      {t('deleteConfirm')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </li>
        ))}
        {canAdd ? (
          <li className="flex">
            <Link
              href={routes.newAddress}
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
