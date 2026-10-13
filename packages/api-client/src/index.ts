// Publiczne API klienta: konfiguracja i fetcher (ręczne) oraz funkcje, hooki TanStack Query
// i typy wygenerowane z kontraktu OpenAPI (src/generated, `pnpm api:generate`).
export {
  ApiError,
  NETWORK_ERROR_STATUS,
  REQUEST_ID_HEADER,
  apiClientConfig,
  apiFetch,
  configureApiClient,
  isApiError,
  resetApiClient,
  type ApiClientConfig,
  type BodyType,
  type ErrorType,
} from './fetcher.js';
export * from './generated/index.js';
export * from './generated/model/index.js';
