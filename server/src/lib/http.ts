import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import multer from "multer";
import type { z } from "zod";

/**
 * Every error response has the same shape on every route: `{ error, code }`.
 * `error` is a human-readable sentence safe to show users; `code` is a stable,
 * machine-readable identifier for clients that want to branch on it.
 */
export interface ErrorBody {
  error: string;
  code: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/** zod `error` option for a field: "X is required." when it's missing, "X must be …" when it's the wrong type. */
export function fieldError(label: string, expected: string) {
  return {
    error: (issue: { input?: unknown }) =>
      issue.input === undefined ? `${label} is required.` : `${label} must be ${expected}.`,
  };
}

/** Validates a request body (or any input) against a zod schema, or throws a 400. */
export function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(400, "VALIDATION_ERROR", result.error.issues[0]?.message ?? "Invalid input.");
  }
  return result.data;
}

/** Route params are `string | string[]` in Express 5's types; ours are always single strings. */
export function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "VALIDATION_ERROR", `Missing route parameter "${name}".`);
  }
  return value;
}

/** Postgres text columns can't hold NUL bytes; reject them up front instead of failing with a 500. */
export function hasNoNulBytes(value: string): boolean {
  return !value.includes(String.fromCharCode(0));
}

/** Reads a `?limit=` style query value: a whole number from 1 to `max`, or `fallback` when absent. */
export function parseLimit(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw === "string" && /^[0-9]{1,6}$/.test(raw)) {
    const value = Number(raw);
    if (value >= 1 && value <= max) return value;
  }
  throw new HttpError(400, "VALIDATION_ERROR", `limit must be a whole number from 1 to ${max}.`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found.", code: "NOT_FOUND" } satisfies ErrorBody);
};

// Prisma error codes that mean "the database couldn't be reached or timed out".
const DATABASE_UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

function toErrorResponse(err: unknown): { status: number; body: ErrorBody; log: boolean } {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.message, code: err.code }, log: false };
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return { status: 413, body: { error: "Files can be at most 4 MB.", code: "FILE_TOO_LARGE" }, log: false };
    }
    return {
      status: 400,
      body: { error: 'Upload exactly one file in the "file" field.', code: "INVALID_UPLOAD" },
      log: false,
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return { status: 409, body: { error: "That already exists.", code: "CONFLICT" }, log: false };
    }
    if (err.code === "P2025") {
      return { status: 404, body: { error: "Not found.", code: "NOT_FOUND" }, log: false };
    }
    if (err.code === "P2003") {
      return {
        status: 409,
        body: { error: "That changed while you were working. Refresh and try again.", code: "CONFLICT" },
        log: false,
      };
    }
    if (DATABASE_UNAVAILABLE_CODES.has(err.code)) {
      return {
        status: 503,
        body: { error: "The database is unavailable. Try again in a moment.", code: "DATABASE_UNAVAILABLE" },
        log: true,
      };
    }
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: 503,
      body: { error: "The database is unavailable. Try again in a moment.", code: "DATABASE_UNAVAILABLE" },
      log: true,
    };
  }

  // body-parser errors (malformed JSON, oversized body) carry an HTTP status and a type.
  if (typeof err === "object" && err !== null && "type" in err && "status" in err) {
    const { type, status } = err as { type: unknown; status: unknown };
    if (type === "entity.parse.failed") {
      return { status: 400, body: { error: "The request body isn't valid JSON.", code: "INVALID_JSON" }, log: false };
    }
    if (type === "entity.too.large") {
      return { status: 413, body: { error: "The request body is too large.", code: "PAYLOAD_TOO_LARGE" }, log: false };
    }
    if (typeof status === "number" && status >= 400 && status < 500) {
      return { status, body: { error: "The request couldn't be read.", code: "BAD_REQUEST" }, log: false };
    }
  }

  return { status: 500, body: { error: "Something went wrong.", code: "INTERNAL_ERROR" }, log: true };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const { status, body, log } = toErrorResponse(err);
  if (log) console.error(`${req.method} ${req.path} failed:`, err);
  res.status(status).json(body);
};
