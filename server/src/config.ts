import { z } from "zod";

// Treat `FOO=` (empty) the same as an unset variable.
const optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is not set." })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgresql:// connection string."),
  // Comma-separated list of browser origins allowed to call the API (CORS) and to open the
  // room socket with the session cookie.
  CLIENT_ORIGIN: z.string().default("http://localhost:3000"),
  // Express "trust proxy": a hop count ("1"), "true"/"false", or a list of trusted addresses.
  TRUST_PROXY: z.string().default("1"),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-5-5"),
  // "auto" uses Claude when ANTHROPIC_API_KEY is set and the built-in generator otherwise.
  QUIZ_GENERATOR: z.enum(["auto", "llm", "heuristic"]).default("auto"),
  WS_TICK_MS: z.coerce.number().int().min(20).max(60_000).default(1000),
  UPLOAD_DIR: optionalString,
});

export interface AppConfig {
  nodeEnv: "development" | "production" | "test";
  isProduction: boolean;
  port: number;
  clientOrigins: string[];
  trustProxy: boolean | number | string;
  anthropicApiKey: string | undefined;
  anthropicModel: string;
  quizGenerator: "auto" | "llm" | "heuristic";
  wsTickMs: number;
  uploadDir: string | undefined;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function parseTrustProxy(raw: string): boolean | number | string {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new ConfigError(`Invalid server configuration:\n${problems}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === "production",
    port: e.PORT,
    clientOrigins: e.CLIENT_ORIGIN.split(",").map(normalizeOrigin).filter(Boolean),
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    anthropicModel: e.ANTHROPIC_MODEL,
    quizGenerator: e.QUIZ_GENERATOR,
    wsTickMs: e.WS_TICK_MS,
    uploadDir: e.UPLOAD_DIR,
  };
}

let cached: AppConfig | undefined;

/** Parsed once from process.env; index.ts calls this at boot so bad config fails fast. */
export function getConfig(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

/** For tests that change process.env after the first read. */
export function reloadConfig(): AppConfig {
  cached = undefined;
  return getConfig();
}
