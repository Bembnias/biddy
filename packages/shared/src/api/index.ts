// Kontrakt błędów API (RFC 9457) wspólny dla serwera i klientów.
export {
  ERROR_CODES,
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPE_BASE_URI,
  isErrorCode,
  isProblemDetails,
  problemTypeUri,
  type ErrorCode,
  type ProblemCode,
  type ProblemDetails,
  type ProblemFieldError,
} from './problem-details.js';
