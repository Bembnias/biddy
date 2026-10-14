import type { CategoryDto } from '@biddy/api-client';
import type { AttributeDefinition, AttributeValues } from '@biddy/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { attributesSchema } from '@/lib/catalog/attributes-schema';
import { mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { AttributeFields } from './attribute-fields';
import { CategoryPicker } from './category-picker';

function category(
  id: string,
  name: string,
  parentId: string | null,
  extra: Partial<CategoryDto> = {},
): CategoryDto {
  return {
    id,
    parentId,
    slug: id,
    name,
    path: [id],
    depth: parentId === null ? 0 : 1,
    isLeaf: parentId !== null,
    isRestricted: false,
    isBrandSensitive: false,
    ...extra,
  };
}

const CATEGORIES = [
  category('kolekcjonerstwo', 'Kolekcjonerstwo', null),
  category('karty', 'Karty kolekcjonerskie', 'kolekcjonerstwo', { isBrandSensitive: true }),
  category('militaria', 'Militaria', 'kolekcjonerstwo', { isRestricted: true }),
  category('inne', 'Inne', null, { isLeaf: true }),
];

describe('CategoryPicker', () => {
  it('kolejne poziomy aż do liścia; wybór liścia z komunikatem o podróbkach', async () => {
    mockApi({ '/v1/categories': CATEGORIES });
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CategoryPicker value={undefined} onChange={onChange} />, { wrapper: AppWrapper });

    await user.selectOptions(await screen.findByLabelText('Kategoria'), 'Kolekcjonerstwo');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByRole('status').textContent).toBe(
      'Wybierz podkategorię, żeby przejść dalej.',
    );

    await user.selectOptions(screen.getByLabelText('Podkategoria'), 'Karty kolekcjonerskie');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'karty' }));
    expect(screen.getByRole('status').textContent).toBe(
      'Wybrano: Kolekcjonerstwo › Karty kolekcjonerskie',
    );
    expect(screen.getByText(/narażona na podróbki/)).toBeDefined();

    await user.selectOptions(screen.getByLabelText('Kategoria'), 'Inne');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'inne' }));
    expect(screen.queryByLabelText('Podkategoria')).toBeNull();
  });

  it('wartość początkowa odtwarza ścieżkę; błąd pola przy ostatnim poziomie', async () => {
    mockApi({ '/v1/categories': CATEGORIES });
    render(<CategoryPicker value="militaria" onChange={vi.fn()} error="Wybierz kategorię." />, {
      wrapper: AppWrapper,
    });
    const sub = await screen.findByLabelText('Podkategoria');
    expect((sub as HTMLSelectElement).value).toBe('militaria');
    expect(sub.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/moderację przed publikacją/)).toBeDefined();
  });

  it('błąd API: komunikat i ponowienie', async () => {
    let calls = 0;
    mockApi({
      '/v1/categories': () => {
        calls += 1;
        return calls === 1
          ? Response.json(
              {
                type: 'x',
                title: 't',
                status: 503,
                detail: 'x',
                instance: '/v1/categories',
                code: 'SERVICE_UNAVAILABLE',
                requestId: 'r',
              },
              { status: 503, headers: { 'content-type': 'application/problem+json' } },
            )
          : Response.json(CATEGORIES);
      },
    });
    const user = userEvent.setup();
    render(<CategoryPicker value={undefined} onChange={vi.fn()} />, { wrapper: AppWrapper });
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Nie udało się wczytać kategorii',
    );
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByLabelText('Kategoria')).toBeDefined();
  });
});

const DEFINITIONS: AttributeDefinition[] = [
  {
    key: 'model',
    label: 'Model',
    type: 'text',
    required: true,
    maxLength: 20,
    hint: 'Np. iPhone 13',
  },
  { key: 'rozmiarEu', label: 'Rozmiar', type: 'number', min: 15, max: 52, unit: 'EU' },
  {
    key: 'kolor',
    label: 'Kolor',
    type: 'select',
    options: [
      { value: 'czarny', label: 'Czarny' },
      { value: 'bialy', label: 'Biały' },
    ],
  },
  { key: 'pudelko', label: 'Oryginalne pudełko', type: 'boolean' },
];

function AttributesForm({ onSubmit }: { readonly onSubmit: (values: AttributeValues) => void }) {
  const form = useForm({
    resolver: zodResolver(z.object({ attributes: attributesSchema(DEFINITIONS) })),
    defaultValues: { attributes: {} },
  });
  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((values) => {
            onSubmit(values.attributes);
          })(event)
        }
      >
        <AttributeFields definitions={DEFINITIONS} />
        <button type="submit">Dalej</button>
      </form>
    </FormProvider>
  );
}

describe('AttributeFields', () => {
  it('pola z definicji: etykiety z jednostką i oznaczeniem wymaganego, podpowiedź, opcje', () => {
    render(<AttributesForm onSubmit={vi.fn()} />, { wrapper: AppWrapper });
    expect(screen.getByRole('group', { name: 'Szczegóły przedmiotu' })).toBeDefined();
    expect(screen.getByLabelText('Model, wymagane').getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByLabelText('Rozmiar (EU)').getAttribute('type')).toBe('number');
    expect(screen.getByRole('option', { name: 'Biały' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Oryginalne pudełko' })).toBeDefined();
  });

  it('walidacja jak w API (po polsku), potem wartości gotowe do wysłania', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AttributesForm onSubmit={onSubmit} />, { wrapper: AppWrapper });

    await user.type(screen.getByLabelText('Rozmiar (EU)'), '60');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(await screen.findByText('Pole „Model” jest wymagane.')).toBeDefined();
    expect(screen.getByText('Pole „Rozmiar” musi być liczbą od 15 do 52.')).toBeDefined();
    expect(screen.getByLabelText('Model, wymagane').getAttribute('aria-invalid')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Model, wymagane'), '  iPhone 13  ');
    await user.clear(screen.getByLabelText('Rozmiar (EU)'));
    await user.type(screen.getByLabelText('Rozmiar (EU)'), '42.5');
    await user.selectOptions(screen.getByLabelText('Kolor'), 'Biały');
    await user.click(screen.getByRole('checkbox', { name: 'Oryginalne pudełko' }));
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        model: 'iPhone 13',
        rozmiarEu: 42.5,
        kolor: 'bialy',
        pudelko: true,
      });
    });
  });
});
