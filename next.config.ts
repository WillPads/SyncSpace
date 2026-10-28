import type { NextConfig } from "next";

// Loopback, 0.0.0.0 and private-range addresses: Vercel can't reach these, so a rewrite to one 404s.
const PRIVATE_HOST =
  /^(localhost|0\.0\.0\.0|::1?|127\..*|10\..*|192\.168\..*|172\.(1[6-9]|2\d|3[01])\..*|.*\.local)$/i;

/** Returns what is wrong with a URL env var, or null if it is fine. Never echoes more than the hostname. */
function urlProblem(name: string, value: string | undefined, protocols: string[]): string | null {
  if (!value) return `${name} is not set`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${name} is not a valid URL`;
  }
  if (!protocols.includes(url.protocol)) {
    return `${name} must start with ${protocols.map((p) => `${p}//`).join(" or ")}`;
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // IPv6 hostnames come wrapped in [ ]
  if (PRIVATE_HOST.test(host)) return `${name} points at a private address (${host})`;
  return null;
}

// Fail the Vercel production build loudly instead of silently proxying to localhost
// (that gave 404 DNS_HOSTNAME_RESOLVED_PRIVATE and a vague "Something went wrong" on signup).
// NEXT_PUBLIC_* values are baked in at build time, so they must be correct *before* the build.
const vercelEnv = process.env.VERCEL_ENV;
if (vercelEnv === "production" || vercelEnv === "preview") {
  const problems = [
    urlProblem("SERVER_URL", process.env.SERVER_URL, ["http:", "https:"]),
    urlProblem("NEXT_PUBLIC_WS_URL", process.env.NEXT_PUBLIC_WS_URL, ["ws:", "wss:"]),
  ].filter((p): p is string => p !== null);

  if (problems.length > 0) {
    const message =
      `Bad server URL config for the ${vercelEnv} build: ${problems.join("; ")}. ` +
      "Set them in Vercel -> Settings -> Environment Variables, then redeploy.";
    if (vercelEnv === "production") throw new Error(message);
    console.warn(`[next.config] WARNING: ${message}`);
  }

  if (vercelEnv === "production" && process.env.NEXT_PUBLIC_WS_URL?.startsWith("ws://")) {
    console.warn("[next.config] WARNING: NEXT_PUBLIC_WS_URL uses ws://; use wss:// in production.");
  }
}

// Local dev/build keeps the localhost default; the trailing slash is stripped so the rewrite never has "//".
const SERVER_URL = (process.env.SERVER_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // REST calls go through this origin, which keeps the auth cookie first-party and
  // avoids CORS. In production the room WebSocket connects to the server directly
  // (NEXT_PUBLIC_WS_URL + a short-lived ticket), because Vercel can't proxy upgrades.
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${SERVER_URL}/:path*` }];
  },
};

export default nextConfig;
