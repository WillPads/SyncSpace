import "dotenv/config";
import http from "node:http";
import { createApp } from "./app.js";
import { ConfigError, getConfig } from "./config.js";
import { prisma } from "./db.js";
import { purgeExpiredAuthRecords } from "./lib/auth.js";
import { recoverInterruptedDocuments } from "./lib/documentPipeline.js";
import { whenIdle } from "./lib/pipelineQueue.js";
import { attachWebSocketServer } from "./ws/index.js";

const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 10_000;

function loadConfigOrExit() {
  try {
    return getConfig();
  } catch (err) {
    // Fail fast with a readable message instead of a crash on the first request.
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  }
}

const config = loadConfigOrExit();

// A stray rejected promise shouldn't take every room's live connection down with it.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

const app = createApp();
const server = http.createServer(app);
const realtime = attachWebSocketServer(server);

function housekeeping(): void {
  purgeExpiredAuthRecords().catch((err: unknown) => console.error("Session cleanup failed:", err));
}
const housekeepingTimer = setInterval(housekeeping, HOUSEKEEPING_INTERVAL_MS);
housekeepingTimer.unref();

server.listen(config.port, "0.0.0.0", () => {
  console.log(`SyncSpace server listening on :${config.port}`);
  housekeeping();
  recoverInterruptedDocuments()
    .then((count) => {
      if (count > 0) console.log(`Re-queued ${count} document(s) interrupted by the last shutdown.`);
    })
    .catch((err: unknown) => console.error("Document recovery failed:", err));
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: shutting down.`);

  const forceExit = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS);
  forceExit.unref();

  clearInterval(housekeepingTimer);
  realtime.close(1001, "Server restarting");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Let in-flight document jobs finish if they can; anything cut off is re-queued on next boot.
  await Promise.race([whenIdle(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS / 2))]);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
