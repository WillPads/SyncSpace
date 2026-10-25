import type { NextConfig } from "next";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // REST calls go through this origin, which keeps the auth cookie first-party and
  // avoids CORS. In production the room WebSocket connects to the server directly
  // (NEXT_PUBLIC_WS_URL + a short-lived ticket), because Vercel can't proxy upgrades.
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${SERVER_URL}/:path*` }];
  },
};

export default nextConfig;
