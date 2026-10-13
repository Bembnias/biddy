'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type Control, Controller, type FieldValues, type Path } from 'react-hook-form';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { routes } from '@/lib/routes';

/** Pola zgody: regulamin z polityką prywatności i oświadczenie 18+ (PROJECT.md §4). */
export function ConsentCheckboxes<T extends FieldValues>({
  control,
  errors,
}: {
  readonly control: Control<T>;
  readonly errors: {
    readonly acceptTerms?: string | undefined;
    readonly adultDeclaration?: string | undefined;
  };
}) {
  const t = useTranslations('auth.fields');
  const link = (href: string) => (chunks: React.ReactNode) => (
    <Link href={href} target="_blank" className="text-primary underline underline-offset-4">
      {chunks}
    </Link>
  );
  const items = [
    {
      name: 'acceptTerms',
      label: t.rich('acceptTerms', { terms: link(routes.terms), privacy: link(routes.privacy) }),
      error: errors.acceptTerms,
    },
    { name: 'adultDeclaration', label: t('adultDeclaration'), error: errors.adultDeclaration },
  ] as const;
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Controller
          key={item.name}
          control={control}
          name={item.name as Path<T>}
          render={({ field }) => (
            <div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id={item.name}
                  checked={field.value === true}
                  onCheckedChange={(checked) => {
                    field.onChange(checked === true);
                  }}
                  onBlur={field.onBlur}
                  aria-invalid={item.error === undefined ? undefined : true}
                  aria-describedby={item.error === undefined ? undefined : `${item.name}-error`}
                  className="mt-0.5"
                />
                <Label htmlFor={item.name} className="leading-snug font-normal">
                  {item.label}
                </Label>
              </div>
              {item.error === undefined ? null : (
                <p id={`${item.name}-error`} className="mt-1 text-sm text-destructive">
                  {item.error}
                </p>
              )}
            </div>
          )}
        />
      ))}
    </div>
  );
}
