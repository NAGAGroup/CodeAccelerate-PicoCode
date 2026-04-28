/**
 * POST /v1/chat/completions
 *
 * OpenAI-compatible chat completions endpoint backed by OpenCode via
 * ai-sdk-provider-opencode-sdk + Vercel AI SDK streamText.
 *
 * Standard OpenAI fields honoured:
 *   model, messages, stream, max_tokens (ignored — OpenCode controls this)
 *
 * OpenCode-specific extensions (via request body or headers):
 *   body.opencode.directory     | X-Opencode-Directory   → per-request workdir
 *   body.opencode.agent         | X-Opencode-Agent       → agent name ("build" etc.)
 *   body.opencode.session_id    | X-Opencode-Session-Id  → resume existing session
 *   body.opencode.session_title | X-Opencode-Session-Title
 *
 * The body fields take precedence over headers.
 */

import { Hono } from "hono";
import { streamText } from "ai";
import {
  createOpencode,
  type OpencodeProvider,
} from "ai-sdk-provider-opencode-sdk";
import { convertMessages, type OAIMessage } from "../lib/messages.js";
import { aiStreamToSSE, collectCompletion } from "../lib/stream.js";

// ─── Provider singleton ──────────────────────────────────────────────────────
//
// autoStartServer: true — the SDK will connect to an existing opencode serve
// instance if one is already running on the configured host/port, or start one
// automatically if not. Set OPENCODE_HOST / OPENCODE_PORT to override defaults.

let _provider: OpencodeProvider | null = null;

function getProvider(): OpencodeProvider {
  if (!_provider) {
    _provider = createOpencode({
      hostname: process.env.OPENCODE_HOST ?? "127.0.0.1",
      port: Number(process.env.OPENCODE_PORT ?? 4096),
      autoStartServer: true,
    });
  }
  return _provider;
}

// ─── Request body type ───────────────────────────────────────────────────────

interface ChatRequest {
  model: string;
  messages: OAIMessage[];
  stream?: boolean;
  // Non-standard OpenCode extension block
  opencode?: {
    directory?: string;
    agent?: string;
    session_id?: string;
    session_title?: string;
  };
}

// ─── Route ───────────────────────────────────────────────────────────────────

export const chatRouter = new Hono();

chatRouter.post("/", async (c) => {
  let body: ChatRequest;
  try {
    body = await c.req.json<ChatRequest>();
  } catch {
    return c.json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, 400);
  }

  const { model, messages, stream: wantStream = false, opencode: ocExt } = body;

  if (!model) {
    return c.json({ error: { message: "'model' is required", type: "invalid_request_error" } }, 400);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: { message: "'messages' must be a non-empty array", type: "invalid_request_error" } }, 400);
  }

  // Resolve OpenCode-specific options (body ext > headers)
  const directory =
    ocExt?.directory ??
    c.req.header("X-Opencode-Directory") ??
    undefined;
  const agent =
    ocExt?.agent ??
    c.req.header("X-Opencode-Agent") ??
    undefined;
  const sessionId =
    ocExt?.session_id ??
    c.req.header("X-Opencode-Session-Id") ??
    undefined;
  const sessionTitle =
    ocExt?.session_title ??
    c.req.header("X-Opencode-Session-Title") ??
    undefined;

  // Convert messages
  const { messages: aiMessages, systemPrompt } = convertMessages(messages);

  // Build the model instance with per-request settings
  const provider = getProvider();
  const ocModel = provider(model, {
    ...(agent ? { agent } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionTitle ? { sessionTitle } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(directory ? { directory } : {}),
  });

  if (wantStream) {
    // Streaming: use streamText and convert fullStream to SSE chunks
    let streamResult: ReturnType<typeof streamText>;
    try {
      streamResult = streamText({ model: ocModel, messages: aiMessages });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: { message: msg, type: "server_error" } }, 500);
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of aiStreamToSSE(streamResult.fullStream, model)) {
            controller.enqueue(encoder.encode(chunk));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } else {
    // Non-streaming: use streamText internally and collect the fullStream.
    // Tool calls and results are only surfaced via the stream path, not generateText().
    const result = streamText({ model: ocModel, messages: aiMessages });
    try {
      const completion = await collectCompletion(result.fullStream, model);
      return c.json(completion);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: { message: msg, type: "server_error" } }, 500);
    }
  }
});
