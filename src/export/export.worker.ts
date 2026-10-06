import { createTestPatternSource } from './testPatternSource';
import { createExportWorkerHandler } from './worker';
import type { WorkerScopeLike } from './worker';

// TODO(T7): montage source (ingest -> engine -> render) replaces the test pattern.
createExportWorkerHandler(createTestPatternSource, self as unknown as WorkerScopeLike);
