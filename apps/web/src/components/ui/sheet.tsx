'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * Dolny arkusz na telefonie (F-63) na Radix Dialog: wjeżdża od dołu, z uchwytem u góry. Fokus,
 * Escape i blokada tła jak w oknie dialogowym.
 */
const Sheet = DialogPrimitive.Root;
const SheetTitle = DialogPrimitive.Title;
const SheetDescription = DialogPrimitive.Description;
const SheetClose = DialogPrimitive.Close;

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-950/55" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-t-3xl bg-popover px-4 pt-2.5 pb-6 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-sheet-in',
          className,
        )}
        {...props}
      >
        <span
          aria-hidden
          className="h-1.5 w-10 shrink-0 self-center rounded-full bg-border-strong"
        />
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle };
