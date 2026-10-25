// Local Postgres for development: `npm run db:dev`, left running in its own terminal.
// Data persists in server/.dev-db between runs. Production uses Neon (DATABASE_URL on Render),
// so local experiments never touch real data.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(serverRoot, ".dev-db");
const port = Number(process.env.DEV_DB_PORT ?? 5433);
const database = "syncspace";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  port,
  user: "postgres",
  password: "postgres",
  persistent: true,
  onLog: () => {},
});

if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
  console.log("First run: creating the local database cluster (takes about 20 seconds)...");
  await pg.initialise();
}

try {
  await pg.start();
} catch {
  console.error(`Couldn't start Postgres on port ${port}. Is it already running in another terminal?`);
  process.exit(1);
}

const admin = pg.getPgClient("postgres", "127.0.0.1");
await admin.connect();
const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
if (!rowCount) await admin.query(`CREATE DATABASE ${database}`);
await admin.end();

const url = `postgresql://postgres:postgres@127.0.0.1:${port}/${database}`;
console.log(`Local Postgres is running on 127.0.0.1:${port} (Ctrl+C to stop).`);
console.log(`server/.env should have:\n  DATABASE_URL="${url}"\n  DIRECT_URL="${url}"`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
