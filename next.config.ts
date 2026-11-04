import type { NextConfig } from "next";
import { MAX_REQUEST_BYTES } from "./shared/images";

const nextConfig: NextConfig = {
  output: "standalone",
  // pino stays a plain Node require (it is on Next's own list too), so the standalone build traces it into node_modules.
  // prom-client the same: one module instance for every route bundle, and its Node internals (v8, perf_hooks) stay as they are.
  // better-sqlite3 (a native module) and pg the same: plain requires, loaded only when NOTEFEED_STORAGE asks for them.
  // sharp the same: it loads its WebAssembly build at run time (backend/imageprocess.ts).
  serverExternalPackages: ["pino", "prom-client", "better-sqlite3", "pg", "sharp"],
  // proxy.ts sees every POST, so Next buffers its body, by default only up to 10 MB: several full-size photos, or one as base64 over MCP, need more.
  experimental: { proxyClientMaxBodySize: MAX_REQUEST_BYTES },
  // proxy.ts handles trailing slashes itself: POST /<feed>/ stores the note, everything else gets a 308.
  skipTrailingSlashRedirect: true,
  // /r/<readId>/<name>.<ext> is a file of the feed; a note id has no dot, so notes stay on their page; feed.xml is the RSS route.
  rewrites: async () => [{ source: "/r/:readId/:file((?!feed\\.xml$)[^/]+\\.[a-z0-9]+)", destination: "/r/:readId/files/:file" }],
  // The OAuth login hands a code to whatever host the client registered: no framing it (clickjacking a
  // password manager's autofill and the "Allow" click).
  headers: async () => [{ source: "/oauth/authorize", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] }],
  // Images are processed by sharp's WebAssembly build (@img/sharp-wasm32, ADR 0049), never by native libvips: leave out the native
  // packages. The proxy's trace doesn't take these excludes, so the Dockerfile removes what it brings; backend/imageprocess.ts
  // refuses to load them either way.
  outputFileTracingExcludes: {
    "*": ["node_modules/@img/sharp-linux*/**", "node_modules/@img/sharp-libvips*/**", "node_modules/@img/sharp-darwin*/**", "node_modules/@img/sharp-win32*/**"],
  },
};

export default nextConfig;
