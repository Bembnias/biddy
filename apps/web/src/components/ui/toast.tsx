'use client';

import { X } from 'lucide-react';
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Toast as ToastPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * Toasty według projektu „Puls licytacji” (F-63) na Radix Toast: kafelek ikony w tonie zdarzenia,
 * tytuł, opis i akcja. Radix ogłasza treść czytnikom ekranu, wstrzymuje czas przy najechaniu
 * i fokusie, a Escape i F8 działają z klawiatury.
 */
const ToastProvider = ToastPrimitive.Provider;

function ToastViewport({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        // Na telefonie u góry ekranu, żeby nie zasłaniać paska licytacji; na desktopie pod nagłówkiem.
        'fixed inset-x-3 top-3 z-60 flex max-h-dvh flex-col gap-3 outline-none sm:inset-x-auto sm:top-20 sm:right-6 sm:w-96',
        className,
      )}
      {...props}
    />
  );
}

const toastVariants = cva(
  'pointer-events-auto relative flex gap-3.5 rounded-xl border bg-card p-4 text-card-foreground shadow-lg data-[state=open]:animate-toast-in data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=cancel]:translate-x-0',
  {
    variants: {
      tone: {
        urgent: 'border-red-200',
        success: 'border-border',
        brand: 'border-border',
        warning: 'border-border',
      },
    },
    defaultVariants: { tone: 'brand' },
  },
);

const toastIconVariants = cva(
  'grid size-10 shrink-0 place-items-center rounded-lg [&>svg]:size-5.5',
  {
    variants: {
      tone: {
        urgent: 'bg-urgent text-primary-foreground',
        success: 'bg-success-soft text-success',
        brand: 'bg-accent text-accent-foreground',
        warning: 'bg-urgent-soft text-urgent',
      },
    },
    defaultVariants: { tone: 'brand' },
  },
);

type ToastTone = NonNullable<VariantProps<typeof toastVariants>['tone']>;

function Toast({
  className,
  tone,
  icon,
  children,
  closeLabel,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root> &
  VariantProps<typeof toastVariants> & {
    readonly icon: React.ReactNode;
    readonly closeLabel: string;
  }) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      data-tone={tone}
      className={cn(toastVariants({ tone }), className)}
      {...props}
    >
      <span aria-hidden className={toastIconVariants({ tone })}>
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      <ToastPrimitive.Close
        aria-label={closeLabel}
        className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-foreground-secondary outline-none hover:bg-muted focus-visible:shadow-focus-ring"
      >
        <X aria-hidden className="size-4" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

function ToastTitle({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Title>) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn('text-title font-extrabold', className)}
      {...props}
    />
  );
}

function ToastDescription({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Description>) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn('text-body-sm text-foreground-secondary', className)}
      {...props}
    />
  );
}

const ToastAction = ToastPrimitive.Action;

export {
  Toast,
  ToastAction,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  type ToastTone,
  ToastViewport,
};
