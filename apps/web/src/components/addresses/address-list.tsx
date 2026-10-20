'use client';

import {
  type AddressDto,
  getGetMyAddressesQueryKey,
  useDeleteAddress,
  useUpdateAddress,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
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
import { Button } from '@/components/ui/button';
import { formatPhoneNumber } from '@/lib/phone';
import { editAddressUrl } from '@/lib/routes';

/** Jedna linia adresu do komunikatów, np. „ul. Długa 5, 00-950 Warszawa”. */
function addressLine(address: AddressDto): string {
  return `${address.street}, ${address.postalCode} ${address.city}`;
}

/**
 * Adresy z akcjami (F-10): edycja, ustawienie domyślnego adresu dostawy i nadania, usunięcie
 * z potwierdzeniem. Po zmianie strona (SSR) odświeża listę.
 */
export function AddressList({ addresses }: { readonly addresses: readonly AddressDto[] }) {
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
      <ul className="space-y-4">
        {addresses.map((address) => (
          <li key={address.id} className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap gap-2">
              {address.isDefault ? (
                <Chip tone="brand-outline" shape="pill">
                  {t('defaultDelivery')}
                </Chip>
              ) : null}
              {address.isSenderDefault ? <Chip shape="pill">{t('defaultSender')}</Chip> : null}
            </div>
            <address className="mt-3 not-italic">
              <p className="font-medium">{address.recipientName}</p>
              <p>{address.street}</p>
              <p>
                {address.postalCode} {address.city}
              </p>
              <p className="text-muted-foreground">{formatPhoneNumber(address.phone)}</p>
            </address>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={editAddressUrl(address.id)}>{t('edit')}</Link>
              </Button>
              {address.isDefault ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
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
                  variant="outline"
                  size="sm"
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
                  <Button type="button" variant="outline" size="sm" disabled={pending}>
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
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
      </ul>
    </div>
  );
}
