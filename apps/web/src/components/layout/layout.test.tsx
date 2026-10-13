import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IntlWrapper } from '@/test/intl';

import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';
import { SkipLink } from './skip-link';

describe('nagłówek', () => {
  it('logo prowadzi na stronę główną, akcje mają etykiety także jako ikony', () => {
    render(<SiteHeader />, { wrapper: IntlWrapper });

    expect(screen.getByRole('link', { name: 'Biddy, strona główna' }).getAttribute('href')).toBe(
      '/',
    );
    const navigation = screen.getByRole('navigation', { name: 'Nawigacja główna' });
    expect(
      within(navigation).getByRole('link', { name: 'Wystaw przedmiot' }).getAttribute('href'),
    ).toBe('/wystaw');
    expect(within(navigation).getByRole('link', { name: 'Zaloguj się' }).getAttribute('href')).toBe(
      '/logowanie',
    );
  });

  it('wyszukiwarka: formularz GET /szukaj z polem q i etykietą', () => {
    render(<SiteHeader />, { wrapper: IntlWrapper });

    const search = screen.getByRole('search');
    expect(search.getAttribute('action')).toBe('/szukaj');
    expect(search.getAttribute('method')).toBe('get');
    const input = within(search).getByRole('searchbox', { name: 'Szukaj na Biddy' });
    expect(input.getAttribute('name')).toBe('q');
    expect(within(search).getByRole('button', { name: 'Szukaj' })).toBeDefined();
  });
});

describe('link „Przejdź do treści”', () => {
  it('prowadzi do #main', () => {
    render(<SkipLink />, { wrapper: IntlWrapper });
    expect(screen.getByRole('link', { name: 'Przejdź do treści' }).getAttribute('href')).toBe(
      '#main',
    );
  });
});

describe('stopka', () => {
  it('grupy linków informacyjnych i prawnych oraz rok', () => {
    render(<SiteFooter year={2027} />, { wrapper: IntlWrapper });

    const footer = screen.getByRole('contentinfo', { name: 'Stopka' });
    for (const group of ['Biddy', 'Pomoc', 'Zasady']) {
      expect(within(footer).getByRole('navigation', { name: group })).toBeDefined();
    }
    expect(within(footer).getByRole('link', { name: 'Regulamin' }).getAttribute('href')).toBe(
      '/regulamin',
    );
    expect(within(footer).getByText(/© 2027 Biddy/)).toBeDefined();
  });
});
