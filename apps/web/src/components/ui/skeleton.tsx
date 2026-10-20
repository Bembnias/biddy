import { cn } from '@/lib/utils';

/** Szkielet ładowania w kształcie docelowej treści (F-62); bez animacji przy ograniczonym ruchu. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  );
}

export { Skeleton };
