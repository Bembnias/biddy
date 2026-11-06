// Mapa punktów odbioru (F-64): widżet Furgonetki w przeglądarce. Web pokazuje ją tylko dla usług
// z punktami, gdy punkty pochodzą z Furgonetki, i ustawia jej środowisko zgodne z API, żeby kod
// punktu z mapy dało się sprawdzić u tego samego dostawcy.
import type { CarrierKind } from '../db/shipping.schema.js';

export const POINT_MAP_ENVS = ['sandbox', 'production'] as const;
export type PointMapEnv = (typeof POINT_MAP_ENVS)[number];

export interface PointMap {
  readonly provider: 'furgonetka';
  /** Kod usługi w mapie i API Furgonetki, np. `inpost`. */
  readonly service: string;
  readonly env: PointMapEnv;
}

export interface PointMapCarrier {
  readonly kind: CarrierKind;
  readonly providerCodes: Readonly<Partial<Record<string, string>>>;
}

/**
 * Mapa dla usługi albo null: kurier nie ma punktów, a FakeShipping nie ma mapy (web pokazuje
 * wtedy wyszukiwarkę). Środowisko wynika z adresu API Furgonetki.
 */
export function pointMapFor(
  carrier: PointMapCarrier,
  pointsProvider: string,
  furgonetkaApiUrl: string | undefined,
): PointMap | null {
  const service = carrier.providerCodes['furgonetka'];
  if (
    carrier.kind === 'COURIER' ||
    pointsProvider !== 'furgonetka' ||
    furgonetkaApiUrl === undefined ||
    service === undefined ||
    service === ''
  ) {
    return null;
  }
  const sandbox = new URL(furgonetkaApiUrl).hostname.includes('sandbox');
  return { provider: 'furgonetka', service, env: sandbox ? 'sandbox' : 'production' };
}
