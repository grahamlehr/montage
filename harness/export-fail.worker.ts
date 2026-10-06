import { createTestPatternSource } from '../src/export/testPatternSource';
import { createExportWorkerHandler } from '../src/export/worker';
import type { WorkerScopeLike } from '../src/export/worker';

// Test-only worker: the first FAIL_ENCODERS VideoEncoders created fail at runtime after FAIL_AFTER frames
// (error callback invoked, encoder closed), simulating a hardware encoder rejecting mid-stream.
// Worker name is '<failEncoders>:<failAfter>'.
const [FAIL_ENCODERS = 1, FAIL_AFTER = 40] = self.name.split(':').map(Number);
const RealEncoder = VideoEncoder;
let created = 0;

class FlakyEncoder extends RealEncoder {
  private n = 0;
  private readonly flaky: boolean;
  private readonly onError: (e: DOMException) => void;
  private dead = false;
  constructor(init: VideoEncoderInit) {
    super(init);
    this.flaky = created++ < FAIL_ENCODERS;
    this.onError = init.error;
  }
  override encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
    if (this.dead) throw new DOMException('closed', 'InvalidStateError');
    if (this.flaky && this.n++ >= FAIL_AFTER) {
      this.dead = true;
      if (this.state !== 'closed') this.close();
      queueMicrotask(() => this.onError(new DOMException('Injected encoder failure', 'EncodingError')));
      return;
    }
    super.encode(frame, options);
  }
}
(self as unknown as { VideoEncoder: unknown }).VideoEncoder = FlakyEncoder;

createExportWorkerHandler(createTestPatternSource, self as unknown as WorkerScopeLike);
