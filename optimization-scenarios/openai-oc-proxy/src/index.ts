/**
 * openai-oc-proxy — OpenAI-compatible HTTP proxy for OpenCode
 *
 * Wraps OpenCode via ai-sdk-provider-opencode-sdk + Vercel AI SDK.
 * Exposes an OpenAI Chat Completions API at /v1/chat/completions.
 *
 * Usage:
 *   bun run src/index.ts
 *
 *   The proxy will connect to an existing OpenCode server on OPENCODE_PORT
 *   (default 4096) or start one automatically if none is running.
 *
 * Environment variables:
 *   PORT             Proxy listen port (default: 8080)
 *   OPENCODE_HOST    OpenCode server hostname (default: 127.0.0.1)
 *   OPENCODE_PORT    OpenCode server port (default: 4096)
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { chatRouter } from "./routes/chat.js";
import { modelsRouter } from "./routes/models.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Health
app.get("/health", (c) => c.json({ status: "ok" }));

// OpenAI-compatible routes
app.route("/v1/chat/completions", chatRouter);
app.route("/v1/models", modelsRouter);

// 404 fallback
app.notFound((c) =>
  c.json({ error: { message: `Route ${c.req.method} ${c.req.path} not found`, type: "invalid_request_error" } }, 404),
);

// Error handler
app.onError((err, c) => {
  console.error("[proxy error]", err);
  return c.json({ error: { message: err.message, type: "server_error" } }, 500);
});

// ─── Start ───────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 8080);
const opencodeHost = process.env.OPENCODE_HOST ?? "127.0.0.1";
const opencodePort = process.env.OPENCODE_PORT ?? "4096";

console.log(`[proxy] Starting on port ${port}`);
console.log(`[proxy] OpenCode target: http://${opencodeHost}:${opencodePort} (auto-start enabled)`);

export default {
  port,
  fetch: app.fetch,
};
