'use client';

import { TrendingUp } from 'lucide-react';
import { useState } from 'react';

import { Chip } from '@/components/ui/chip';
import { shortMoney } from '@/lib/auction/auction-state';

/**
 * Cena z impulsem (F-63): po wzroście ceny (zdarzenie na żywo) krótko podświetlone tło
 * i plakietka przyrostu („+10 zł”), która zostaje do kolejnej zmiany. Przy ograniczonym ruchu
 * podświetlenie znika od razu, a plakietka zostaje.
 */
export function PriceTicker({
  amount,
  currency,
}: {
  readonly amount: number;
  readonly currency: 'PLN';
}) {
  // Poprzednia cena w stanie (wzorzec „informacja z poprzedniego renderu”), bez efektów.
  const [tracked, setTracked] = useState({ amount, delta: 0, pulse: 0 });
  if (tracked.amount !== amount) {
    setTracked(
      amount > tracked.amount
        ? { amount, delta: amount - tracked.amount, pulse: tracked.pulse + 1 }
        : { amount, delta: 0, pulse: tracked.pulse },
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2.5">
      <span
        // Nowy klucz przy każdym wzroście uruchamia podświetlenie od nowa.
        key={tracked.pulse}
        data-testid="auction-price"
        className={
          tracked.pulse === 0
            ? 'text-price-xl tabular-nums'
            : 'relative isolate -mx-2 px-2 text-price-xl tabular-nums before:absolute before:inset-0 before:-z-10 before:animate-flash before:rounded-lg before:bg-violet-100'
        }
      >
        {shortMoney(amount, currency)}
      </span>
      {tracked.delta > 0 ? (
        <Chip tone="brand" shape="pill" className="tabular-nums">
          <TrendingUp aria-hidden />+{shortMoney(tracked.delta, currency)}
        </Chip>
      ) : null}
    </span>
  );
}
