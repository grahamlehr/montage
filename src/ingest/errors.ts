export type IngestErrorCode = 'unsupported' | 'decode-failed' | 'invalid-size';

/** Typed error thrown by all ingest functions. `code` is stable; `message` is user-facing. */
export class IngestError extends Error {
  readonly code: IngestErrorCode;
  constructor(code: IngestErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IngestError';
    this.code = code;
  }
}
