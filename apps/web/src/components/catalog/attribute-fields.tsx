'use client';

import type { AttributeDefinition } from '@biddy/shared';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Controller, get, useFormContext } from 'react-hook-form';

import { TextField } from '@/components/auth/form-parts';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

/** Lista wyboru z etykietą, podpowiedzią i błędem (jak TextField). */
function SelectField({
  definition,
  label,
  name,
  error,
}: {
  readonly definition: Extract<AttributeDefinition, { type: 'select' }>;
  readonly label: string;
  readonly name: string;
  readonly error: string | undefined;
}) {
  const t = useTranslations('catalog.attributes');
  const { register } = useFormContext();
  const id = useId();
  const describedBy = [
    definition.hint === undefined ? null : `${id}-hint`,
    error === undefined ? null : `${id}-error`,
  ]
    .filter((value) => value !== null)
    .join(' ');
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        {...register(name)}
      >
        <option value="">{t('choose')}</option>
        {definition.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      {definition.hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {definition.hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Pola atrybutów kategorii generowane z definicji (F-11), w formularzu react-hook-form
 * (FormProvider). Wartości trafiają do `<name>.<klucz>`; walidację daje attributesSchema
 * (lib/catalog/attributes-schema.ts), ta sama co w API.
 */
export function AttributeFields({
  definitions,
  name = 'attributes',
}: {
  readonly definitions: readonly AttributeDefinition[];
  readonly name?: string;
}) {
  const t = useTranslations('catalog.attributes');
  const { register, control, formState } = useFormContext();
  if (definitions.length === 0) {
    return null;
  }
  return (
    <fieldset className="space-y-4">
      <legend className="text-lg font-semibold">{t('title')}</legend>
      {definitions.map((definition) => {
        const path = `${name}.${definition.key}`;
        const error = (get(formState.errors, path) as { message?: string } | undefined)?.message;
        const label = [
          definition.label,
          definition.type === 'number' && definition.unit !== undefined
            ? ` (${definition.unit})`
            : '',
          definition.required === true && definition.type !== 'boolean' ? `, ${t('required')}` : '',
        ].join('');
        switch (definition.type) {
          case 'text':
            return (
              <TextField
                key={definition.key}
                label={label}
                hint={definition.hint}
                error={error}
                maxLength={definition.maxLength}
                {...register(path)}
              />
            );
          case 'number':
            return (
              <TextField
                key={definition.key}
                label={label}
                hint={definition.hint}
                error={error}
                type="number"
                inputMode={definition.integer === true ? 'numeric' : 'decimal'}
                step={definition.integer === true ? 1 : 'any'}
                min={definition.min}
                max={definition.max}
                {...register(path, { valueAsNumber: true })}
              />
            );
          case 'select':
            return (
              <SelectField
                key={definition.key}
                definition={definition}
                label={label}
                name={path}
                error={error}
              />
            );
          case 'boolean':
            return (
              <Controller
                key={definition.key}
                control={control}
                name={path}
                render={({ field }) => (
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={`${path}-checkbox`}
                      checked={field.value === true}
                      onCheckedChange={(checked) => {
                        field.onChange(checked === true);
                      }}
                      onBlur={field.onBlur}
                    />
                    <Label htmlFor={`${path}-checkbox`}>{label}</Label>
                  </div>
                )}
              />
            );
        }
      })}
    </fieldset>
  );
}
