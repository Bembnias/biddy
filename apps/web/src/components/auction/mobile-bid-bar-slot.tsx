/** Identyfikator miejsca na pasek licytacji (bez 'use client': importuje go też strona serwerowa). */
export const MOBILE_BID_BAR_ID = 'mobile-bid-bar';

/**
 * Miejsce na pasek licytacji na telefonie (F-63) na końcu strony aukcji: wypełnia je panel
 * licytacji przez portal. `sticky` przykleja pasek do dołu ekranu tylko do końca strony aukcji,
 * więc nie zasłania stopki.
 */
export function MobileBidBarSlot() {
  return (
    <div
      id={MOBILE_BID_BAR_ID}
      className="sticky bottom-0 z-30 -mx-4 mt-8 -mb-6 md:-mx-10 lg:hidden"
    />
  );
}
