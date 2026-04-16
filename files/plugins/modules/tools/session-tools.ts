import { tool } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import type { PluginDeps } from "../deps";
import { dagStatePath, readState, writeState, now } from "../../state-io";

export function createSessionTools(deps: PluginDeps) {
  const { resolveWorktree } = deps;

  return {
    plan_session: tool({
      description:
        "Start a /plan-session planning session. Copies the global planning DAG locally and activates it.",
      args: {},
      async execute(_args, context) {
        const worktree = resolveWorktree(context);
        const statePath = dagStatePath(worktree, context.sessionID);
        const state = readState(statePath);
        if (!state) return "Failed to activate plan session.";
        return `Planning session has begun. Wait for your next step.`;
      },
    }),

    activate_plan: tool({
      description: "Activate a project DAG produced by a planning session.",
      args: {
        plan_name: tool.schema.string().describe("The plan name."),
      },
      async execute({ plan_name }, context) {
        const worktree = resolveWorktree(context);
        const statePath = dagStatePath(worktree, context.sessionID);
        const state = readState(statePath);
        if (!state) return `Failed to activate plan "${plan_name}".`;
        return `Plan execution has begun. Wait for your next step.`;
      },
    }),
  };
}
