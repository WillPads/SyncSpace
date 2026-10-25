import os from "node:os";
import path from "node:path";
import { inject } from "vitest";

// Runs in every test worker before any test file is imported. The database comes from
// globalSetup.ts; server/.env is deliberately never loaded here.
const databaseUrl = inject("databaseUrl");
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = databaseUrl;
process.env.CLIENT_ORIGIN = "http://localhost:3000";
process.env.WS_TICK_MS = "50";
process.env.UPLOAD_DIR = path.join(os.tmpdir(), "syncspace-test-uploads");
// Never call the real Anthropic API from tests (it would cost money and be flaky).
process.env.QUIZ_GENERATOR = "heuristic";
delete process.env.ANTHROPIC_API_KEY;
