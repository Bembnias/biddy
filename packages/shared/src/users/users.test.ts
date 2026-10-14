import { describe, expect, it } from 'vitest';

import { displayNameIssue, normalizeDisplayName, normalizePostalCode } from './index.js';

describe('imię wyświetlane', () => {
  it.each([
    'Kasia Kupująca',
    'Staszek_99',
    "O'Connor",
    'Anna-Maria K.',
    'Łukasz Żółć',
    'Jo',
    'Zoë',
    'a'.repeat(60),
  ])('przyjmuje: %s', (name) => {
    expect(displayNameIssue(name)).toBeUndefined();
  });

  it.each([
    ['za krótkie', 'J', 'length'],
    ['same spacje', '   ', 'length'],
    ['za długie', 'a'.repeat(61), 'length'],
    ['e-mail', 'jan@example.com', 'characters'],
    ['emoji', 'Kasia 🙂', 'characters'],
    ['znaczniki HTML', '<b>Jan</b>', 'characters'],
    ['numer telefonu', 'Jan 500 600 700', 'contact'],
    ['numer bez spacji', 'Jan500600700', 'contact'],
    ['adres www', 'www.sklep', 'contact'],
    ['domena', 'tanie-buty.pl', 'contact'],
    ['http', 'http sklep', 'contact'],
  ])('odrzuca %s', (_label, name, issue) => {
    expect(displayNameIssue(name)).toBe(issue);
  });

  it('normalizacja: przycięcie i pojedyncze spacje', () => {
    expect(normalizeDisplayName('  Kasia \t  Kupująca \n')).toBe('Kasia Kupująca');
  });
});

describe('kod pocztowy', () => {
  it.each([
    ['00-950', '00-950'],
    ['00950', '00-950'],
    [' 31-042 ', '31-042'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePostalCode(input)).toBe(expected);
  });

  it.each(['1234', '00-9500', '0O-950', '00 950', ''])('odrzuca %s', (input) => {
    expect(normalizePostalCode(input)).toBeUndefined();
  });
});
