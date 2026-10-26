// Punkty odbioru FakeShipping (F-24): stała, przewidywalna lista wokół wskazanego miejsca
// (domyślnie centrum Warszawy). Dwa magiczne punkty ustawiają scenariusz przesyłki:
// `…-NOPICKUP` (paczka nieodebrana, zwrot do nadawcy) i `…-LOST` (utyka w drodze).
import type { PickupPoint, PickupPointQuery } from '../../ports/shipping-provider.port.js';

const WARSAW = { lat: 52.2297, lng: 21.0122 };
/** Zwykłe punkty na liście (01–08) przed punktami magicznymi. */
const REGULAR_POINTS = 8;
/** Odstęp między punktami (stopnie szerokości, około 220 m). */
const STEP_DEGREES = 0.002;
const METERS_PER_DEGREE = 111_000;

function pointName(query: PickupPointQuery, label: string): string {
  return `${query.carrier.kind === 'LOCKER' ? 'Paczkomat' : 'Punkt'} testowy ${label}`;
}

function openingHours(query: PickupPointQuery): string {
  return query.carrier.kind === 'LOCKER' ? '24/7' : 'pn–pt 8:00–20:00, sob 9:00–15:00';
}

function point(query: PickupPointQuery, suffix: string, label: string, index: number): PickupPoint {
  const center = query.near ?? WARSAW;
  const city =
    query.phrase?.trim() === undefined || query.phrase.trim() === ''
      ? 'Warszawa'
      : query.phrase.trim();
  const number = index + 1;
  return {
    id: `${query.carrier.id}-${suffix}`,
    name: pointName(query, label),
    address: `ul. Testowa ${number}, 00-${String(number).padStart(3, '0')} ${city}`,
    location: { lat: center.lat + number * STEP_DEGREES, lng: center.lng },
    distanceMeters: Math.round(number * STEP_DEGREES * METERS_PER_DEGREE),
    openingHours: openingHours(query),
  };
}

/** Wszystkie punkty usługi (kurier nie ma punktów). */
function allPoints(query: PickupPointQuery): PickupPoint[] {
  if (query.carrier.kind === 'COURIER') {
    return [];
  }
  const regular = Array.from({ length: REGULAR_POINTS }, (_, index) => {
    const code = String(index + 1).padStart(2, '0');
    return point(query, code, code, index);
  });
  return [
    ...regular,
    point(query, 'NOPICKUP', '(nieodebrana)', REGULAR_POINTS),
    point(query, 'LOST', '(zaginie)', REGULAR_POINTS + 1),
  ];
}

/** Punkty dla zapytania: jeden punkt po `pointId` albo lista do limitu. */
export function fakePickupPoints(query: PickupPointQuery): PickupPoint[] {
  const points = allPoints(query);
  if (query.pointId !== undefined) {
    return points.filter((candidate) => candidate.id === query.pointId);
  }
  return points.slice(0, query.limit);
}
