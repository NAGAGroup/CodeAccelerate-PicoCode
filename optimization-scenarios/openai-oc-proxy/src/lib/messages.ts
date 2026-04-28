/**
 * Convert OpenAI chat messages to AI SDK v6 ModelMessage format.
 *
 * We extract system messages and return them separately so they can be passed
 * as OpenCode's explicit systemPrompt override (rather than as a message).
 */

import type {
  ModelMessage,
  UserModelMessage,
  AssistantModelMessage,
  ToolModelMessage,
} from "ai";

// ─── OpenAI wire types (minimal) ────────────────────────────────────────────

export interface OAIContentPartText {
  type: "text";
  text: string;
}

export interface OAIContentPartImage {
  type: "image_url";
  image_url: { url: string; detail?: string };
}

export type OAIContentPart = OAIContentPartText | OAIContentPartImage;

export interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OAIContentPart[] | null;
  name?: string;
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function contentToString(content: string | OAIContentPart[] | null): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p): p is OAIContentPartText => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// ─── Conversion ─────────────────────────────────────────────────────────────

/**
 * Convert OpenAI messages → AI SDK v6 ModelMessage[].
 * System messages are extracted and returned separately.
 */
export function convertMessages(oaiMessages: OAIMessage[]): {
  messages: ModelMessage[];
  systemPrompt: string | undefined;
} {
  const systemParts: string[] = [];
  const messages: ModelMessage[] = [];

  for (const msg of oaiMessages) {
    // ── system ──────────────────────────────────────────────────────────────
    if (msg.role === "system") {
      const text = contentToString(msg.content);
      if (text) systemParts.push(text);
      continue;
    }

    // ── user ─────────────────────────────────────────────────────────────────
    if (msg.role === "user") {
      if (typeof msg.content === "string" || msg.content == null) {
        const userMsg: UserModelMessage = {
          role: "user",
          content: contentToString(msg.content),
        };
        messages.push(userMsg);
      } else {
        // Multi-part content: text only (images passed as data URLs go through
        // the text part since OpenCode doesn't support URL-based images)
        const textContent = msg.content
          .filter((p): p is OAIContentPartText => p.type === "text")
          .map((p) => p.text)
          .join("");
        const userMsg: UserModelMessage = {
          role: "user",
          content: textContent,
        };
        messages.push(userMsg);
      }
      continue;
    }

    // ── assistant ────────────────────────────────────────────────────────────
    if (msg.role === "assistant") {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const content: AssistantModelMessage["content"] = [];
        const text = contentToString(msg.content);
        if (text) {
          content.push({ type: "text", text });
        }
        for (const tc of msg.tool_calls) {
          let parsedInput: unknown;
          try {
            parsedInput = JSON.parse(tc.function.arguments || "{}");
          } catch {
            parsedInput = tc.function.arguments;
          }
          content.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.function.name,
            input: parsedInput,
          });
        }
        const assistantMsg: AssistantModelMessage = { role: "assistant", content };
        messages.push(assistantMsg);
      } else {
        const assistantMsg: AssistantModelMessage = {
          role: "assistant",
          content: contentToString(msg.content),
        };
        messages.push(assistantMsg);
      }
      continue;
    }

    // ── tool ─────────────────────────────────────────────────────────────────
    if (msg.role === "tool") {
      const toolMsg: ToolModelMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: msg.tool_call_id ?? "",
            toolName: msg.name ?? "",
            output: { type: "text" as const, value: contentToString(msg.content) },
          },
        ],
      };
      messages.push(toolMsg);
      continue;
    }
  }

  return {
    messages,
    systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
  };
}
