type Job = () => Promise<void>;

/**
 * In-process job queue for document processing (no Redis in this deployment). At most
 * CONCURRENCY jobs run at once so one slow LLM call doesn't hold up every other upload.
 * Jobs survive restarts because their state lives in the Document row: on boot,
 * recoverInterruptedDocuments() re-queues anything left PENDING or PARSING.
 */
const CONCURRENCY = 2;

const queue: Job[] = [];
let running = 0;
let idleWaiters: Array<() => void> = [];

export function enqueue(job: Job): void {
  queue.push(job);
  pump();
}

function pump(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    running += 1;
    job()
      .catch((err: unknown) => console.error("Pipeline job failed:", err))
      .finally(() => {
        running -= 1;
        pump();
        if (running === 0 && queue.length === 0) {
          const waiters = idleWaiters;
          idleWaiters = [];
          for (const resolve of waiters) resolve();
        }
      });
  }
}

/** Resolves once every queued job has finished (used by tests and graceful shutdown). */
export function whenIdle(): Promise<void> {
  if (running === 0 && queue.length === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}
