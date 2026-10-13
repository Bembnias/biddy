// Publiczne API warstwy HTTP. Moduły domenowe korzystają stąd z DomainError.
export { DomainError, type DomainErrorOptions } from './domain-error.js';
export {
  ERROR_DEFINITIONS,
  codeForStatus,
  isErrorStatus,
  type ErrorDefinition,
} from './error-catalog.js';
export {
  AppFastifyAdapter,
  createHttpAdapter,
  type HttpAdapterOptions,
} from './fastify-adapter.js';
export { toProblemDetails, type MappedProblem, type ProblemContext } from './problem-details.js';
export {
  ProblemDetailsFilter,
  type ProblemDetailsFilterOptions,
} from './problem-details.filter.js';
export {
  PROBLEM_CONTENT_TYPE_HEADER,
  replyWithProblem,
  type ProblemResponseOptions,
} from './problem-response.js';
export {
  REQUEST_ID_HEADER,
  REQUEST_ID_PATTERN,
  isValidRequestId,
  requestIdFor,
  resolveRequestId,
} from './request-id.js';
export {
  API_CSP_DIRECTIVES,
  DOCS_CSP_DIRECTIVES,
  FALLBACK_SECURITY_HEADERS,
  cspHeaderValue,
  isDocsRoute,
  registerSecurityHeaders,
} from './security-headers.js';
export { pathWithoutQuery } from './url.js';
