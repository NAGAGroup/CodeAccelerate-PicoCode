import { tool } from "@opencode-ai/plugin";
import type { PluginDeps } from "../deps";
import { dagStatePath, writeState, now } from "../../state-io";
import { copyPlanningDag } from "../../dag-lifecycle";
import { flattenTreeV3 } from "../../dag-tree";
import { recompilePlan } from "../dag_engine/compiler";
import { ensureGrepai } from "../hooks/tool-before-hooks/grepai-lifecycle";
import type { DagSessionState } from "../../types";

export function createSessionTools(deps: PluginDeps) {
  const { resolveWorktree } = deps;

  return {
    plan_session: tool({
      description:
        "Start a /plan-session planning session. Copies the global planning DAG locally and activates it.",
      args: {},
      async execute(_args, context) {
        const worktree = resolveWorktree(context);
        ensureGrepai(worktree);

        const { localPlanPath, metadata, nodes } = copyPlanningDag(
          "plan-session",
          context.sessionID,
          worktree,
        );

        const plan_name = `plan-session-${context.sessionID}`;
        const promptsPrefix = `.opencode/session-plans/${plan_name}/prompts/`;
        for (const node of nodes) {
          if (!node.prompt.includes("/"))
            node.prompt = `${promptsPrefix}${node.prompt}`;
        }

        const nodeMap = flattenTreeV3(metadata, nodes);
        const entryNode = nodeMap[metadata.entry_node_id];
        if (!entryNode)
          throw new Error(
            `Entry node "${metadata.entry_node_id}" not found in DAG`,
          );

        const statePath = dagStatePath(worktree, context.sessionID);
        const state: DagSessionState = {
          dag_id: metadata.id,
          plan_path: localPlanPath,
          status: "running",
          current_node: metadata.entry_node_id,
          todo_index: 0,
          started_at: now(),
          updated_at: now(),
          decisions: [],
          node_map: nodeMap,
          planning_session_id: plan_name,
        };
        writeState(statePath, state);

        if (entryNode.enforcement.length === 0) {
          state.status =
            entryNode.children && entryNode.children.length > 0
              ? "waiting_step"
              : "complete";
          writeState(statePath, state);
        }

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
        ensureGrepai(worktree);

        const { compiledPlanPath, metadata, nodeMap } = recompilePlan(
          plan_name,
          worktree,
        );

        const entryNode = nodeMap[metadata.entry_node_id];
        if (!entryNode)
          throw new Error(
            `Entry node "${metadata.entry_node_id}" not found in DAG "${plan_name}"`,
          );

        const statePath = dagStatePath(worktree, context.sessionID);
        const state: DagSessionState = {
          dag_id: metadata.id,
          plan_path: compiledPlanPath,
          status: "running",
          current_node: metadata.entry_node_id,
          todo_index: 0,
          started_at: now(),
          updated_at: now(),
          decisions: [],
          node_map: nodeMap,
          plan_name: plan_name,
        };
        writeState(statePath, state);

        if (entryNode.enforcement.length === 0) {
          state.status =
            entryNode.children && entryNode.children.length > 0
              ? "waiting_step"
              : "complete";
          writeState(statePath, state);
        }

        return `Plan execution has begun. Wait for your next step.`;
      },
    }),
  };
}
