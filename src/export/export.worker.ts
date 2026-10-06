import { createMontageSource } from './montageSource';
import { createExportWorkerHandler } from './worker';
import type { WorkerScopeLike } from './worker';

createExportWorkerHandler(createMontageSource, self as unknown as WorkerScopeLike);
