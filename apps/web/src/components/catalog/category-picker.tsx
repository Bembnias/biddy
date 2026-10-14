'use client';

import { type CategoryDto, useGetCategories } from '@biddy/api-client';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';

import { CategoryNotices } from './category-notices';

/** Identyfikatory od kategorii głównej do wskazanej (pusta lista dla braku wyboru). */
function trailOf(categoryId: string | undefined, byId: ReadonlyMap<string, CategoryDto>): string[] {
  const trail: string[] = [];
  for (
    let node = categoryId === undefined ? undefined : byId.get(categoryId);
    node !== undefined;
  ) {
    trail.unshift(node.id);
    node = node.parentId === null ? undefined : byId.get(node.parentId);
  }
  return trail;
}

/**
 * Wybór kategorii krok po kroku (F-11): kolejny poziom pojawia się po wyborze, aż do liścia
 * drzewa. `onChange` dostaje kategorię-liść albo undefined (wybór niepełny).
 */
export function CategoryPicker({
  value,
  onChange,
  error,
}: {
  readonly value: string | undefined;
  readonly onChange: (category: CategoryDto | undefined) => void;
  readonly error?: string | undefined;
}) {
  const t = useTranslations('catalog.picker');
  const baseId = useId();
  const errorId = `${baseId}-error`;
  const { data, isPending, isError, refetch } = useGetCategories({
    query: { staleTime: 5 * 60_000 },
  });
  const [trail, setTrail] = useState<string[]>();

  if (isPending) {
    return <Skeleton className="h-10 w-full" />;
  }
  if (isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
        {t('loadError')}
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const byId = new Map(data.map((category) => [category.id, category]));
  const selected = trail ?? trailOf(value, byId);
  const childrenOf = (parentId: string | null) =>
    data.filter((category) => category.parentId === parentId);
  const levels: { parentId: string | null; options: CategoryDto[] }[] = [
    { parentId: null, options: childrenOf(null) },
  ];
  for (const id of selected) {
    const options = childrenOf(id);
    if (options.length > 0) {
      levels.push({ parentId: id, options });
    }
  }
  const last = byId.get(selected.at(-1) ?? '');
  const leaf = last?.isLeaf === true ? last : undefined;

  const choose = (level: number, id: string) => {
    const next = id === '' ? selected.slice(0, level) : [...selected.slice(0, level), id];
    setTrail(next);
    const chosen = byId.get(next.at(-1) ?? '');
    onChange(chosen?.isLeaf === true ? chosen : undefined);
  };

  return (
    <div className="space-y-4">
      {levels.map((level, index) => {
        const id = `${baseId}-${String(index)}`;
        const isLast = index === levels.length - 1;
        return (
          <div key={level.parentId ?? 'root'} className="space-y-2">
            <Label htmlFor={id}>{index === 0 ? t('category') : t('subcategory')}</Label>
            <NativeSelect
              id={id}
              value={selected[index] ?? ''}
              aria-invalid={isLast && error !== undefined ? true : undefined}
              aria-describedby={isLast && error !== undefined ? errorId : undefined}
              onChange={(event) => {
                choose(index, event.target.value);
              }}
            >
              <option value="">{t('choose')}</option>
              {level.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        );
      })}
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {leaf === undefined
          ? selected.length > 0
            ? t('chooseLeaf')
            : null
          : t('selected', {
              path: trailOf(leaf.id, byId)
                .map((id) => byId.get(id)?.name ?? '')
                .join(' › '),
            })}
      </p>
      {leaf === undefined ? null : (
        <CategoryNotices
          isBrandSensitive={leaf.isBrandSensitive}
          isRestricted={leaf.isRestricted}
        />
      )}
    </div>
  );
}
