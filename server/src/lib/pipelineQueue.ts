type Job = () => Promise<void>;

const queue: Job[] = [];
let running = false;

/** No Redis/BullMQ available in this environment - a simple FIFO in-process queue instead. */
export function enqueue(job: Job): void {
  queue.push(job);
  void drain();
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const job = queue.shift()!;
    try {
      await job();
    } catch (err) {
      console.error("Pipeline job failed:", err);
    }
  }
  running = false;
}
