/** Ścieżki sond (bez prefiksu /v1, patrz create-app.ts). */
export const HEALTH_PATH = 'health';
export const READY_PATH = 'ready';

/** Ścieżki sond z ukośnikiem, np. do wyłączenia automatycznych logów żądań. */
export const PROBE_PATHS: readonly string[] = [`/${HEALTH_PATH}`, `/${READY_PATH}`];

/**
 * Górny limit czasu sprawdzeń w /ready: sonda ma odpowiadać szybko także przy awarii.
 * Zabezpieczenie na wypadek sprawdzenia bez własnego limitu (DatabaseHealth ma ~2 s).
 */
export const READY_TIMEOUT_MS = 3000;
