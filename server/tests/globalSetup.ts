import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

/**
 * Gives the test run its own Postgres. Set TEST_DATABASE_URL to use an existing database
 * (e.g. a CI service); otherwise an embedded Postgres 17 is started from `.test-db/`
 * (initialised on first run, about 20 s) with a fresh database for every run. Tests never
 * read DATABASE_URL from server/.env, so they can't touch real data.
 */
declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(serverRoot, ".test-db");
const DATABASE = "syncspace_test";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function migrate(databaseUrl: string): void {
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  try {
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
      stdio: "pipe",
    });
  } catch (err) {
    const output = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`prisma migrate deploy failed:\n${output.stdout ?? ""}${output.stderr ?? ""}`);
  }
}

async function startEmbedded(port: number): Promise<EmbeddedPostgres> {
  const make = () =>
    new EmbeddedPostgres({
      databaseDir: DATA_DIR,
      port,
      user: "postgres",
      password: "postgres",
      persistent: true,
      onLog: () => {},
      // Throwaway test data: trade durability for speed, and allow every worker its pool.
      postgresFlags: ["-c", "max_connections=300", "-c", "fsync=off", "-c", "synchronous_commit=off"],
    });

  let pg = make();
  if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) await pg.initialise();
  try {
    await pg.start();
  } catch {
    // A cluster left broken by a killed run: start over from scratch.
    rmSync(DATA_DIR, { recursive: true, force: true });
    pg = make();
    await pg.initialise();
    await pg.start();
  }
  return pg;
}

export default async function setup(project: TestProject) {
  let pg: EmbeddedPostgres | undefined;
  let databaseUrl = process.env.TEST_DATABASE_URL;

  if (!databaseUrl) {
    const port = await freePort();
    pg = await startEmbedded(port);
    const admin = pg.getPgClient("postgres", "127.0.0.1");
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DATABASE}`);
    await admin.end();
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/${DATABASE}`;
  }

  migrate(databaseUrl);
  // Each test file runs in its own worker with its own Prisma pool; keep the pools small.
  const separator = databaseUrl.includes("?") ? "&" : "?";
  project.provide("databaseUrl", `${databaseUrl}${separator}connection_limit=5`);

  return async () => {
    await pg?.stop();
  };
}
