// Mapa punktów odbioru Furgonetki (F-64, https://furgonetka.pl/api/mapa): skrypt strony trzeciej
// ładowany dopiero po kliknięciu „Wybierz na mapie”, raz na stronę. Mapa oddaje tylko kod, nazwę
// i typ punktu; adres i godziny bierzemy z API Biddy, które też sprawdza, czy punkt działa.

export const FURGONETKA_MAP_SCRIPT = 'https://furgonetka.pl/js/dist/map/map.js';

/** Najdłużej czekamy na skrypt mapy; potem checkout proponuje wyszukiwarkę. */
export const MAP_LOAD_TIMEOUT_MS = 10_000;

/** Punkt wybrany na mapie (pola z dokumentacji mapy, wersja 1.0.0). */
export interface FurgonetkaMapPoint {
  readonly code: string;
  readonly name: string;
  readonly type: string;
}

export interface FurgonetkaMapOptions {
  readonly apiKey: string;
  readonly env: 'sandbox' | 'production';
  readonly courierServices: readonly string[];
  readonly courierServicesFilter: readonly string[];
  readonly availableServiceTypes?: readonly ('parcel_machine' | 'service_point')[];
  readonly showServiceTypeFilter: boolean;
  readonly locale: string;
  readonly city?: string;
  readonly postcode?: string;
  readonly pointId?: string;
  readonly callback: (params: { readonly point: FurgonetkaMapPoint }) => void;
  readonly closeModalCallback?: () => void;
}

interface FurgonetkaGlobal {
  readonly Map: new (options: FurgonetkaMapOptions) => { show: () => void };
}

declare global {
  interface Window {
    Furgonetka?: FurgonetkaGlobal;
  }
}

export class MapLoadError extends Error {
  constructor(readonly reason: 'load' | 'timeout') {
    super(reason === 'timeout' ? 'Skrypt mapy nie wczytał się w czasie' : 'Błąd skryptu mapy');
    this.name = 'MapLoadError';
  }
}

let pending: Promise<FurgonetkaGlobal> | undefined;

/**
 * Wczytuje skrypt mapy (raz na stronę). Błąd i przekroczony czas czyszczą stan, więc następne
 * kliknięcie próbuje ponownie.
 */
export function loadFurgonetkaMap(timeoutMs = MAP_LOAD_TIMEOUT_MS): Promise<FurgonetkaGlobal> {
  if (window.Furgonetka !== undefined) {
    return Promise.resolve(window.Furgonetka);
  }
  pending ??= new Promise<FurgonetkaGlobal>((resolve, reject) => {
    const fail = (reason: 'load' | 'timeout') => {
      window.clearTimeout(timer);
      script.remove();
      pending = undefined;
      reject(new MapLoadError(reason));
    };
    const script = document.createElement('script');
    script.src = FURGONETKA_MAP_SCRIPT;
    script.async = true;
    const timer = window.setTimeout(() => {
      fail('timeout');
    }, timeoutMs);
    script.addEventListener('load', () => {
      window.clearTimeout(timer);
      if (window.Furgonetka === undefined) {
        fail('load');
        return;
      }
      resolve(window.Furgonetka);
    });
    script.addEventListener('error', () => {
      fail('load');
    });
    document.head.append(script);
  });
  return pending;
}

/** Tylko do testów: zapomina wczytany skrypt. */
export function resetFurgonetkaMapForTests(): void {
  pending = undefined;
  delete window.Furgonetka;
}
