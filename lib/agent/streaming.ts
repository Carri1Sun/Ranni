const STREAM_DELTA_TICK_MS = 22;
const STREAM_DELTA_MIN_CHARS = 4;
const STREAM_DELTA_MAX_CHARS = 80;

export const CANCELLED_MESSAGE = "已手动终止运行。";

export function createAbortError() {
  const error = new Error(CANCELLED_MESSAGE);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.trim() === CANCELLED_MESSAGE ||
      /^Agent run was cancelled\.?$/i.test(error.message.trim()))
  );
}

export function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createAbortError();
}

function sleep(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function chunkSize(pending: string) {
  const length = Array.from(pending).length;
  if (length <= STREAM_DELTA_MIN_CHARS) return length;
  return Math.min(
    STREAM_DELTA_MAX_CHARS,
    Math.max(STREAM_DELTA_MIN_CHARS, Math.ceil(length / 32)),
  );
}

export class PacedTextEmitter {
  private pending = "";
  private processing: Promise<void> | undefined;

  constructor(
    private readonly emitDelta: (delta: string) => void,
    private readonly signal?: AbortSignal,
  ) {}

  enqueue(delta: string) {
    if (!delta) return;
    this.pending += delta;
    if (!this.processing) this.start();
  }

  async drain() {
    while (this.pending || this.processing) {
      await (this.processing ?? Promise.resolve());
    }
  }

  private start() {
    this.processing = this.flush().catch((error) => {
      if (isAbortError(error)) {
        this.pending = "";
        return;
      }
      throw error;
    });
  }

  private async flush() {
    try {
      while (this.pending) {
        assertNotAborted(this.signal);
        const characters = Array.from(this.pending);
        const size = chunkSize(this.pending);
        const chunk = characters.slice(0, size).join("");
        this.pending = characters.slice(size).join("");
        this.emitDelta(chunk);
        await sleep(STREAM_DELTA_TICK_MS, this.signal);
      }
    } finally {
      this.processing = undefined;
      if (this.pending && !this.signal?.aborted) this.start();
    }
  }
}
