// Publiczne API procesu workera (PROJECT.md §10.4): WorkerRuntimeModule składa src/worker.module.ts,
// a WorkerRuntime.start() uruchamia przetwarzanie (createWorker w src/create-worker.ts).
export {
  STARTUP_CHECK_TIMEOUT_MS,
  WORKER_REDIS,
  WorkerRuntime,
  WorkerStartupError,
  type WorkerSummary,
} from './worker-runtime.js';
export { WorkerRuntimeModule } from './worker-runtime.module.js';
