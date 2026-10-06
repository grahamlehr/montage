import { createTestPatternSource } from './testPatternSource';
import { createExportWorkerHandler } from './worker';
import type { WorkerScopeLike } from './worker';

// Worker entry used by harness/export.html.
createExportWorkerHandler(createTestPatternSource, self as unknown as WorkerScopeLike);
