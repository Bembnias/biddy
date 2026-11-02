// Błędy dostawcy w odpowiedziach API (F-24): niedostępność dostawcy to 503 z ponowieniem,
// a nie 500. Błędy danych z tworzenia przesyłki obsługuje osobno ShipmentService (komunikat dla
// sprzedającego w przesyłce).
import { DomainError } from '../../../infra/http/index.js';
import { isShippingProviderError } from '../ports/shipping-provider.port.js';

/** Wywołanie dostawcy w żądaniu HTTP: UNAVAILABLE → 503 SERVICE_UNAVAILABLE. */
export async function providerCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (isShippingProviderError(error, 'UNAVAILABLE')) {
      throw new DomainError({
        code: 'SERVICE_UNAVAILABLE',
        detail: 'Przewoźnik chwilowo nie odpowiada. Spróbuj ponownie za chwilę.',
        cause: error,
      });
    }
    throw error;
  }
}
