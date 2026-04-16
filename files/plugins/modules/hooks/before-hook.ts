import type { PluginDeps } from "../deps";
import { handleEnforcementBefore } from "./tool-before-hooks/enforcement";

type BeforeHookFn = (input: any, output: any, deps: PluginDeps) => Promise<boolean>;

/**
 * Registered before-hook handlers, executed in order.
 * Each handler returns true if it handled the input (short-circuits remaining handlers).
 *
 * Enforcement is the sole before-hook — it gates all tool calls when a session is active.
 * Tool-specific setup and validation logic lives in each tool's execute().
 */
const pipeline: BeforeHookFn[] = [
  handleEnforcementBefore,
];

export async function beforeHook(
  input: any,
  output: any,
  deps: PluginDeps,
): Promise<void> {
  if (!input.tool || !input.sessionID) return;

  for (const fn of pipeline) {
    const handled = await fn(input, output, deps);
    if (handled) return;
  }
}
