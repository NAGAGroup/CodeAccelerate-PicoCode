/**
 * Convert an AI SDK v6 fullStream (TextStreamPart[]) into OpenAI-compatible SSE chunks.
 *
 * OpenAI SSE wire format:
 *   data: {"id":"chatcmpl-…","object":"chat.completion.chunk","created":…,
 *          "model":"…","choices":[{"index":0,"delta":{…},"finish_reason":null}]}
 *   data: [DONE]
 *
 * AI SDK v6 parts we handle:
 *   text-delta        → delta.content
 *   reasoning-delta   → delta.content
 *   tool-call         → delta.tool_calls[n]
 *   tool-result       → role:"tool" delta chunk
 *   finish            → final chunk with finish_reason + usage, then [DONE]
 *   error             → error chunk before [DONE]
 *
 * Skipped: stream-start, text-start, text-end, reasoning-start, reasoning-end,
 *          tool-input-start/delta/end, tool-approval-request, file, source, start-step
 */

// ─── Minimal AI SDK v6 part shapes we care about ─────────────────────────────
// We use a union of the specific shapes rather than the generic TextStreamPart
// to avoid needing TOOLS type parameter boilerplate at the call sites.

type AnyStreamPart =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
      dynamic?: boolean;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
      dynamic?: boolean;
    }
  | {
      type: "finish";
      finishReason: string;
      totalUsage: { inputTokens?: number; outputTokens?: number };
    }
  | { type: "error"; error: unknown }
  | { type: string; [key: string]: unknown };

// ─── OpenAI wire types ───────────────────────────────────────────────────────

export interface OAIChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: OAIChoice[];
  usage?: OAIUsage;
}

interface OAIChoice {
  index: number;
  delta: OAIDelta;
  finish_reason: string | null;
}

interface OAIDelta {
  role?: string;
  content?: string;
  tool_calls?: OAIToolCallDelta[];
  tool_call_id?: string;
}

interface OAIToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

export interface OAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeId(): string {
  return `chatcmpl-${Math.random().toString(36).slice(2, 12)}`;
}

function sseEvent(chunk: OAIChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function doneLine(): string {
  return `data: [DONE]\n\n`;
}

function errorEvent(message: string): string {
  const payload = { error: { message, type: "server_error", code: null } };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function makeChunk(
  id: string,
  created: number,
  model: string,
  delta: OAIDelta,
  finishReason: string | null = null,
  usage?: OAIUsage,
): string {
  const c: OAIChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
  return sseEvent(c);
}

// ─── Main converter ──────────────────────────────────────────────────────────

/**
 * Iterate over an AI SDK v6 fullStream and yield raw SSE strings.
 */
export async function* aiStreamToSSE(
  fullStream: AsyncIterable<AnyStreamPart>,
  modelId: string,
): AsyncGenerator<string> {
  const id = makeId();
  const created = Math.floor(Date.now() / 1000);

  // Opening role marker
  yield makeChunk(id, created, modelId, { role: "assistant" });

  const toolCallIndexMap = new Map<string, number>();
  let nextToolCallIndex = 0;

  try {
    for await (const part of fullStream) {
      switch (part.type) {
        case "text-delta": {
          const p = part as { type: "text-delta"; text: string };
          if (p.text)
            yield makeChunk(id, created, modelId, { content: p.text });
          break;
        }

        case "reasoning-delta": {
          const p = part as { type: "reasoning-delta"; text: string };
          if (p.text)
            yield makeChunk(id, created, modelId, { content: p.text });
          break;
        }

        case "tool-call": {
          const p = part as {
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            input: unknown;
          };
          if (!toolCallIndexMap.has(p.toolCallId)) {
            toolCallIndexMap.set(p.toolCallId, nextToolCallIndex++);
          }
          const idx = toolCallIndexMap.get(p.toolCallId)!;
          yield makeChunk(id, created, modelId, {
            tool_calls: [
              {
                index: idx,
                id: p.toolCallId,
                type: "function",
                function: {
                  name: p.toolName,
                  arguments:
                    typeof p.input === "string"
                      ? p.input
                      : JSON.stringify(p.input),
                },
              },
            ],
          });
          break;
        }

        case "tool-result": {
          const p = part as {
            type: "tool-result";
            toolCallId: string;
            output: unknown;
          };
          // output may be a ToolResultOutput { type, value } or a plain string/object
          const rawOutput = p.output;
          const result =
            rawOutput == null
              ? ""
              : typeof rawOutput === "string"
                ? rawOutput
                : typeof rawOutput === "object" &&
                    "value" in (rawOutput as object)
                  ? String((rawOutput as { value: unknown }).value)
                  : JSON.stringify(rawOutput);
          yield makeChunk(id, created, modelId, {
            role: "tool",
            tool_call_id: p.toolCallId,
            content: result,
          });
          break;
        }

        case "finish": {
          const p = part as {
            type: "finish";
            finishReason: string;
            totalUsage: { inputTokens?: number; outputTokens?: number };
          };
          const oaiFinish =
            p.finishReason === "tool-calls"
              ? "tool_calls"
              : (p.finishReason ?? "stop");
          const promptTokens = p.totalUsage?.inputTokens ?? 0;
          const completionTokens = p.totalUsage?.outputTokens ?? 0;
          const usage: OAIUsage = {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          };
          yield makeChunk(id, created, modelId, {}, oaiFinish, usage);
          break;
        }

        case "error": {
          const p = part as { type: "error"; error: unknown };
          const msg =
            p.error instanceof Error ? p.error.message : String(p.error);
          yield errorEvent(msg);
          break;
        }

        default:
          break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield errorEvent(msg);
  }

  yield doneLine();
}

// ─── Non-streaming: build completion from generateText() result ──────────────
//
// Tool calls and results are only surfaced via streamText().fullStream, not
// generateText(). So for non-streaming requests we use streamText internally
// and collect the full stream into a JSON completion object.

export interface OAICompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: OAIUsage;
}

export async function collectCompletion(
  fullStream: AsyncIterable<AnyStreamPart>,
  modelId: string,
): Promise<OAICompletion> {
  const id = makeId();
  const created = Math.floor(Date.now() / 1000);
  let content = "";
  let reasoningBuffer = "";
  let finishReason = "stop";
  let usage: OAIUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const flushReasoning = () => {
    if (reasoningBuffer) {
      content += `<thinking>${reasoningBuffer}</thinking>\n`;
      reasoningBuffer = "";
    }
  };

  for await (const part of fullStream) {
    switch (part.type) {
      case "text-delta":
        flushReasoning();
        content += (part as { type: "text-delta"; text: string }).text ?? "";
        break;

      case "reasoning-delta": {
        const p = part as { type: "reasoning-delta"; text: string };
        reasoningBuffer += p.text ?? "";
        break;
      }

      case "tool-call": {
        flushReasoning();
        const p = part as { type: "tool-call"; toolCallId: string; toolName: string; input: unknown };
        const args = typeof p.input === "string" ? p.input : JSON.stringify(p.input);
        content += `\n<tool_call name="${p.toolName}" id="${p.toolCallId}">\n${args}\n</tool_call>\n`;
        break;
      }

      case "tool-result": {
        const p = part as { type: "tool-result"; toolCallId: string; output: unknown };
        const rawOutput = p.output;
        const out =
          rawOutput == null ? "" :
          typeof rawOutput === "string" ? rawOutput :
          typeof rawOutput === "object" && "value" in (rawOutput as object)
            ? String((rawOutput as { value: unknown }).value)
            : JSON.stringify(rawOutput);
        content += `<tool_result id="${p.toolCallId}">\n${out}\n</tool_result>\n`;
        break;
      }

      case "finish": {
        flushReasoning();
        const p = part as { type: "finish"; finishReason: string; totalUsage: { inputTokens?: number; outputTokens?: number } };
        finishReason = p.finishReason === "tool-calls" ? "tool_calls" : (p.finishReason ?? "stop");
        const pt = p.totalUsage?.inputTokens ?? 0;
        const ct = p.totalUsage?.outputTokens ?? 0;
        usage = { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct };
        break;
      }

      default:
        break;
    }
  }

  flushReasoning();

  return {
    id,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
    usage,
  };
}
