import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('rozmiar z tokenów (text-label) i kolor (text-primary-foreground) zostają razem', () => {
    expect(cn('text-label', 'text-primary-foreground')).toBe('text-label text-primary-foreground');
  });

  it('późniejszy styl tekstu zastępuje wcześniejszy', () => {
    expect(cn('text-label', 'text-label-lg')).toBe('text-label-lg');
    expect(cn('text-sm', 'text-h1')).toBe('text-h1');
  });

  it('cienie z tokenów: późniejszy wygrywa, kolor tekstu nie koliduje', () => {
    expect(cn('shadow-xs', 'shadow-cta')).toBe('shadow-cta');
  });
});
