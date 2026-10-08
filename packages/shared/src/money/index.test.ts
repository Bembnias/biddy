import { describe, expect, it } from 'vitest';
import * as moneyModule from './index.js';

describe('publiczne API modułu money', () => {
  it('eksportuje dokładnie te wartości (zmiana listy to świadoma zmiana API)', () => {
    expect(Object.keys(moneyModule).sort()).toEqual([
      'BASIS_POINTS_SCALE',
      'CURRENCIES',
      'CurrencyMismatchError',
      'DEFAULT_CURRENCY',
      'MoneyError',
      'MoneyParseError',
      'abs',
      'add',
      'compare',
      'divideRoundHalfUp',
      'equals',
      'formatMoney',
      'getCurrency',
      'isCurrencyCode',
      'isMoney',
      'isNegative',
      'isPositive',
      'isZero',
      'max',
      'min',
      'money',
      'multiply',
      'negate',
      'parseMoney',
      'percentOf',
      'splitGross',
      'subtract',
      'sum',
      'toDecimalString',
      'zero',
    ]);
  });
});
