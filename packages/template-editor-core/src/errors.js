/** Stable failures across HTTP, File System Access and in-memory hosts. */
export class EditorError extends Error {
  constructor(code, message, { cause, diagnostics = [], sourceDiagnostics = [], status } = {}) {
    super(message, { cause });
    this.code = code;
    this.name = this.constructor.name;
    this.diagnostics = diagnostics;
    this.sourceDiagnostics = sourceDiagnostics;
    if (status !== undefined) this.status = status;
  }
}
export class ConflictError extends EditorError { constructor(message = 'This project changed elsewhere. Reload before saving.', details) { super('conflict', message, details); } }
export class ValidationError extends EditorError { constructor(message = 'The project is invalid.', details) { super('validation', message, details); } }
export class PolicyError extends EditorError { constructor(message = 'This operation is not permitted.', details) { super('policy', message, details); } }
export class TransportError extends EditorError { constructor(message = 'The request failed. Try again.', details) { super('transport', message, details); } }
export class AbortError extends EditorError { constructor(message = 'The operation was cancelled.', details) { super('abort', message, details); } }
const errorClasses = { conflict: ConflictError, validation: ValidationError, policy: PolicyError, transport: TransportError, abort: AbortError };
export function normalizeError(error, fallback = 'transport') {
  if (error instanceof EditorError) return error;
  const code = error?.name === 'AbortError' ? 'abort'
    : error?.code && Object.hasOwn(errorClasses, error.code) ? error.code
    : error?.status === 409 ? 'conflict'
    : error?.status === 422 ? 'validation'
    : error?.status === 403 || error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? 'policy' : fallback;
  const payload = error?.payload || error || {};
  return new (errorClasses[code] || TransportError)(error?.message || String(error), {
    cause: error, diagnostics: payload.diagnostics || [], sourceDiagnostics: payload.sourceDiagnostics || [], status: error?.status,
  });
}
export function throwIfAborted(signal) { if (signal?.aborted) throw new AbortError(); }
/** Check before and after asynchronous work, including synchronous analyzers. */
export async function runOperation(signal, operation, fallback = 'transport') {
  throwIfAborted(signal);
  try { const result = await operation(); throwIfAborted(signal); return result; }
  catch (error) { if (signal?.aborted) throw new AbortError(); throw normalizeError(error, fallback); }
}
