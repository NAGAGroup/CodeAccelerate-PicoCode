import type { PluginDeps } from "../../deps";
import { dagStatePath, readState } from "../../../state-io";
import { readPrompt } from "../../../path-utils";

export async function handleActivatePlanAfter(
  input: any,
  _output: any,
  deps: PluginDeps,
): Promise<boolean> {
  if (input.tool !== "activate_plan") return false;

  const worktree = deps.resolveWorktree(deps.pluginCtx);
  const statePath = dagStatePath(worktree, input.sessionID);
  const state = readState(statePath);
  if (!state) return true;

  const entryNode = state.node_map[state.current_node];
  if (!entryNode) return true;

  const sessionPath = `.opencode/session-plans/${state.plan_name}`;
  const promptText = readPrompt(entryNode.prompt, worktree, sessionPath, {
    plan_name: state.plan_name,
    inject: entryNode.inject,
  });

  const deferredPromptInjection = async (
    _input: any = input,
    _deferredDeps: PluginDeps = deps,
    _promptText: string = promptText,
  ) => {
    // 2000ms sleep
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });

    _deferredDeps.client.session.prompt({
      path: { id: _input.sessionID },
      body: { parts: [{ type: "text", text: _promptText }] },
    });
  };
  deferredPromptInjection();

  return true;
}
