'use client';

// Toasty na żywo (F-63): jedna kolejka na aplikację, najwyżej trzy naraz, najnowszy na górze.
// Toast o tym samym `id` zastępuje poprzedni (kolejne przebicie w tej samej aukcji), a nowy
// klucz restartuje jego czas i ogłoszenie dla czytników ekranu.
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Toast,
  ToastAction,
  ToastDescription,
  ToastProvider as ToastRoot,
  ToastTitle,
  type ToastTone,
  ToastViewport,
} from '@/components/ui/toast';

/** Najwyżej tyle toastów naraz; najstarszy znika, gdy przychodzi kolejny. */
export const MAX_TOASTS = 3;

/** Domyślny czas toastu; przebicie zostaje dłużej (UX w F-63). */
export const TOAST_DURATION_MS = 8_000;
export const URGENT_TOAST_DURATION_MS = 12_000;

export interface ToastOptions {
  /** Toast o tym samym id zastępuje poprzedni. */
  readonly id?: string;
  readonly tone: ToastTone;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description?: ReactNode;
  /** Akcja (granatowy przycisk, nie CTA): link albo funkcja; zamyka toast. */
  readonly action?: {
    readonly label: string;
    readonly href?: string;
    readonly onSelect?: () => void;
  };
  /** Pilne (przebicie): dłuższy czas i ogłoszenie od razu (`type="foreground"`). */
  readonly urgent?: boolean;
}

interface ToastEntry extends ToastOptions {
  readonly id: string;
  readonly key: string;
}

type ShowToast = (toast: ToastOptions) => void;

const ToastContext = createContext<ShowToast | null>(null);

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const t = useTranslations('toast');
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);

  const show = useCallback<ShowToast>((toast) => {
    const id = toast.id ?? crypto.randomUUID();
    setToasts((current) =>
      [
        ...current.filter((entry) => entry.id !== id),
        { ...toast, id, key: crypto.randomUUID() },
      ].slice(-MAX_TOASTS),
    );
  }, []);

  const dismiss = (id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  };

  return (
    <ToastContext value={show}>
      <ToastRoot label={t('label')} duration={TOAST_DURATION_MS} swipeDirection="right">
        {children}
        {toasts.map((toast) => (
          <Toast
            key={toast.key}
            tone={toast.tone}
            icon={<toast.icon />}
            closeLabel={t('close')}
            type={toast.urgent === true ? 'foreground' : 'background'}
            duration={toast.urgent === true ? URGENT_TOAST_DURATION_MS : TOAST_DURATION_MS}
            onOpenChange={(open) => {
              if (!open) {
                dismiss(toast.id);
              }
            }}
          >
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description === undefined ? null : (
              <ToastDescription>{toast.description}</ToastDescription>
            )}
            {toast.action === undefined ? null : (
              <ToastAction asChild altText={toast.action.label}>
                {toast.action.href === undefined ? (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-1.5 self-start"
                    onClick={toast.action.onSelect}
                  >
                    {toast.action.label}
                  </Button>
                ) : (
                  <Button asChild size="sm" className="mt-1.5 self-start">
                    <Link href={toast.action.href} onClick={toast.action.onSelect}>
                      {toast.action.label}
                    </Link>
                  </Button>
                )}
              </ToastAction>
            )}
          </Toast>
        ))}
        {/* Odwrócona kolejność: Radix dokleja nowe toasty na końcu, a najnowszy ma być na górze. */}
        <ToastViewport className="flex-col-reverse" />
      </ToastRoot>
    </ToastContext>
  );
}

/** Pokazuje toast (wymaga ToastProvider z AppProviders). */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (show === null) {
    throw new Error('useToast wymaga ToastProvider (AppProviders)');
  }
  return show;
}
