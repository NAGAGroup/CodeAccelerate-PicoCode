#!/usr/bin/env python3
"""
GEPA prompt optimization harness.

Optimizes the system prompt body of a named OpenCode agent (`--agent`) against
one or more scenarios (`--scenario task_prompt_path,workdir`, repeatable) using
an LM-as-a-judge rubric (`--eval-criteria`).

Architecture:
  - Student is a dspy.Module with one dspy.Predict (TaskSignature) whose
    `.instructions` GEPA mutates across iterations.
  - forward() creates an isolated tmpdir per call: copies the workdir and
    opencode-cfg into it, then runs via the openai-oc-proxy with the tmpdir
    as the OpenCode working directory. Thread-safe; num_threads > 1 is fine.
  - The metric is an LM-as-a-judge (JudgeSignature) that scores the agent's
    full execution transcript against the eval rubric and returns score +
    feedback. The judge is instructed to cite specific tool names in feedback.
  - MethodologyProposer enforces that proposed instructions stay domain-agnostic:
    tool names are allowed, but task/domain specifics (languages, libraries,
    frameworks, file extensions) are banned. This keeps the optimized prompt
    general across arbitrary task domains.
  - The winning .instructions body is written back to
    opencode-cfg/agents/<agent>.md (frontmatter preserved).

Dependencies: dspy  gepa
"""

import argparse
import shutil
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Optional

from tqdm import tqdm as _tqdm


def tprint(*args, **kwargs):
    """tqdm-safe print — won't be overwritten by the GEPA progress bar."""
    _tqdm.write(" ".join(str(a) for a in args), file=kwargs.get("file", sys.stderr))


import dspy
from dspy.teleprompt.gepa.gepa import DSPyTrace


class PassthroughAdapter(dspy.Adapter):
    """
    Minimal adapter for OpenCode sessions.

    format() sends exactly two messages:
      - system: the raw signature instructions (the candidate prompt GEPA optimizes)
      - user:   the raw task input

    No [[ ## field ## ]] markers, no boilerplate — OpenCode receives a clean prompt.

    parse() returns the entire LM response as the `response` output field verbatim,
    so the full transcript (thinking, tool calls, tool results, final text) is
    preserved in pred.response for the judge to evaluate.
    """

    def format(self, signature, demos, inputs):
        return [
            {"role": "system", "content": signature.instructions},
            {"role": "user", "content": inputs.get("task", "")},
        ]

    def parse(self, signature, completion):
        return {"response": completion}
from gepa.core.adapter import ProposalFn


# ======================================================================
# Frontmatter-preserving file IO
# ======================================================================


def split_frontmatter(text: str) -> tuple[str, str]:
    if not text.startswith("---"):
        return "", text
    lines = text.split("\n")
    if lines[0] != "---":
        return "", text
    for i in range(1, len(lines)):
        if lines[i] == "---":
            frontmatter = "\n".join(lines[: i + 1]) + "\n"
            body = "\n".join(lines[i + 1 :]).lstrip("\n")
            return frontmatter, body
    return "", text


def write_with_frontmatter(path: Path, frontmatter: str, body: str) -> None:
    path.write_text(frontmatter + body, encoding="utf-8")


# ======================================================================
# Scenario CLI parsing
# ======================================================================


def parse_scenario(spec: str) -> dict:
    """Parse a `task_prompt_path,workdir` pair from the CLI."""
    parts = [p.strip() for p in spec.split(",")]
    if len(parts) != 2 or not all(parts):
        raise argparse.ArgumentTypeError(
            f"--scenario expects 'task_prompt_path,workdir', got: {spec!r}"
        )
    task_prompt_path, workdir = parts
    if not Path(task_prompt_path).exists():
        raise argparse.ArgumentTypeError(
            f"task prompt path does not exist: {task_prompt_path}"
        )
    if not Path(workdir).is_dir():
        raise argparse.ArgumentTypeError(f"workdir is not a directory: {workdir}")
    return {"task_prompt_path": task_prompt_path, "workdir": workdir}


# ======================================================================
# Student
# ======================================================================


class TaskSignature(dspy.Signature):
    """Execute the provided task. Respond with a summary of your work."""

    task: str = dspy.InputField()
    response: str = dspy.OutputField()


class OpencodeAgent(dspy.Module):
    """
    DSPy module wrapping OpenCode via the openai-oc-proxy.

    GEPA optimizes self.execute.signature.instructions. Each forward() call:
      1. Copies the workdir to a fresh tmpdir (unique per call — thread-safe).
      2. Copies opencode-cfg into tmpdir/.opencode/ so OpenCode finds the
         agent config (permissions, tools, frontmatter).
      3. Creates a dspy.LM pointed at the proxy with the tmpdir passed via
         extra_body. The candidate instructions flow as the system message;
         the proxy forwards them as OpenCode's systemPrompt override.
      4. Calls self.execute(task=...) so GEPA traces the predict call.
      5. Cleans up tmpdir unconditionally.
    """

    def __init__(
        self,
        opencode_cfg: Path,
        agent_name: str,
        initial_instructions: str,
        proxy_url: str,
        model: str,
    ):
        super().__init__()
        self.execute = dspy.Predict(
            TaskSignature.with_instructions(initial_instructions)
        )
        self.opencode_cfg = opencode_cfg
        self.agent_name = agent_name
        self.proxy_url = proxy_url.rstrip("/")
        self.model = model

    def forward(self, task: str, workdir: str) -> dspy.Prediction:
        tmpdir = Path(tempfile.mkdtemp(prefix="oc-opt-"))
        try:
            shutil.copytree(workdir, tmpdir, dirs_exist_ok=True)
            shutil.copytree(
                self.opencode_cfg,
                tmpdir / ".opencode",
                ignore=shutil.ignore_patterns(
                    "node_modules",
                    "package-lock.json",
                    "bun.lock",
                    "*.lock",
                    ".git",
                ),
            )

            lm = dspy.LM(
                model=f"openai/{self.model}",
                api_base=f"{self.proxy_url}/v1",
                extra_body={
                    "opencode": {
                        "directory": str(tmpdir),
                        "agent": self.agent_name,
                    }
                },
                api_key="x",
                timeout=7200,  # 2 hours — agent sessions can be long
            )

            with dspy.context(lm=lm, adapter=PassthroughAdapter()):
                pred = self.execute(task=task)
                tprint(f"\n\n[student]{pred.response}\n\n")
                return pred

        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


# ======================================================================
# Metric: LM-as-a-judge
# ======================================================================


class JudgeSignature(dspy.Signature):
    """Evaluate the agent's full execution response against the provided rubric.

    The response includes the agent's reasoning, all tool calls made and their
    results, and the agent's final response. Score each rubric criterion
    independently, then sum for the total score.

    When providing feedback, cite specific tool names exactly as they appear
    in the rubric (e.g. smart_grep_index_status, Bash, Read) when identifying
    gaps or successes in tool usage. Specific tool names in feedback allow the
    system to incorporate them into improved instructions.
    """

    task: str = dspy.InputField(desc="The task that was given to the agent")
    eval_criteria: str = dspy.InputField(desc="The rubric defining scoring criteria")
    response: str = dspy.InputField(
        desc="The agent's full execution response including reasoning, tool calls and results, and final response"
    )

    score: float = dspy.OutputField(
        desc="Total score from 0.0 to 1.0, summed from per-criterion scores"
    )
    feedback: str = dspy.OutputField(
        desc=(
            "Per-criterion breakdown: what the agent did well, what it missed, "
            "and specific tool names where relevant"
        )
    )


def make_metric(eval_criteria: str, judge_lm: dspy.LM):
    judge = dspy.ChainOfThought(JudgeSignature)

    def metric(
        gold: dspy.Example,
        pred: dspy.Prediction,
        trace: Optional[DSPyTrace] = None,
        pred_name=None,
        pred_trace=None,
    ):
        try:
            response = pred.response
            with dspy.context(lm=judge_lm):
                result = judge(
                    task=gold.task,
                    eval_criteria=eval_criteria,
                    response=response,
                )
            score = float(result.score)
            feedback = str(result.feedback)
            tprint(f"\n\n[metric] score={score:.3f} feedback={feedback}\n\n")
            return dspy.Prediction(score=score, feedback=feedback)
        except Exception as e:
            tprint(f"[metric] FAILED: {type(e).__name__}: {e}")
            traceback.print_exc(file=sys.stderr)
            return dspy.Prediction(
                score=0.0, feedback=f"Judge error: {type(e).__name__}: {e}"
            )

    return metric


# ======================================================================
# Instruction proposer: enforces methodology-only instructions
# ======================================================================


class ProposeImprovedPrompt(dspy.Signature):
    """Improve an AI agent's system prompt based on feedback from evaluation runs.

    Given the current prompt and a set of feedback examples, propose an
    improved version of the prompt.

    Prompt Revision Rules:
    - Always keep the prompt free of any domain-specific or task-specific
      language (e.g. programming languages, build systems, specific shell tools,
      library names, file extensions, framework names, etc. are *banned* from
      the prompt).
    - Tool names that are part of the agent's toolset (e.g. smart_grep_index_status,
      smart_grep_search, Bash, Read, Write, Glob) are *allowed* — they describe
      methodology, not domain.
    - Instead, the prompt should focus on methodology (e.g. tool usage, information
      gathering, completeness, recovery from failures, reporting discipline, etc.).
    - Always keep the prompt applicable across arbitrary task domains.
    """

    current_prompt: str = dspy.InputField(
        desc="The current agent system prompt that needs improvement"
    )
    ideal_behavior: str = dspy.InputField(
        desc="Evaluation rubric that guides ideal agent behavior (for reference only, not scoring)."
    )
    feedback_examples: str = dspy.InputField(
        desc=(
            "Markdown-formatted block containing per-example agent outputs "
            "and rubric-based feedback from evaluation runs"
        )
    )

    improved_prompt: str = dspy.OutputField(
        desc="The full text of the new prompt body (no frontmatter, no fences)"
    )


class MethodologyProposer(ProposalFn):
    """
    Custom instruction proposer that enforces methodology-only revision rules.
    GEPA already wraps the __call__ in dspy.context(lm=reflection_lm), so no
    explicit context management is needed here.
    """

    def __init__(self, eval_criteria: str):
        self._propose = dspy.ChainOfThought(ProposeImprovedPrompt)
        self._eval_criteria = eval_criteria

    def __call__(
        self,
        candidate: dict[str, str],
        reflective_dataset: dict[str, list[dict]],
        components_to_update: list[str],
    ) -> dict[str, str]:
        updated = {}
        for component in components_to_update:
            if component not in candidate or component not in reflective_dataset:
                continue

            current = candidate[component]
            examples = reflective_dataset[component]

            feedback_block = "\n\n".join(
                f"### Example {i + 1}\n"
                f"**Generated Output (excerpt):**\n"
                f"{str(ex.get('Generated Outputs', ''))}\n\n"
                f"**Feedback:**\n{ex.get('Feedback', 'No feedback')}"
                for i, ex in enumerate(examples)
            )

            try:
                result = self._propose(
                    current_prompt=current,
                    ideal_behavior=self._eval_criteria,
                    feedback_examples=feedback_block,
                )
                improved = result.improved_prompt
                if isinstance(improved, str) and improved.strip():
                    updated[component] = improved
                    tprint(
                        f"[proposer] new prompt for '{component}' (len={len(improved)})"
                    )
                else:
                    tprint(f"[proposer] empty result for '{component}'; skipping")
            except Exception as e:
                tprint(f"[proposer] FAILED for '{component}': {type(e).__name__}: {e}")
                traceback.print_exc(file=sys.stderr)

        return updated


# ======================================================================
# Main
# ======================================================================


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scenario",
        type=parse_scenario,
        required=True,
        action="append",
        metavar="TASK_PROMPT_PATH,WORKDIR",
        help=(
            "A scenario as 'task_prompt_path,workdir'. Repeatable; all scenarios "
            "share the same agent and are optimized together."
        ),
    )
    parser.add_argument(
        "--opencode-cfg",
        type=Path,
        required=True,
        help=(
            "Path to the OpenCode config directory (equivalent to .opencode/). "
            "Copied into each tmpdir as .opencode/ during optimization. "
            "The winning prompt is written back to <opencode-cfg>/agents/<agent>.md."
        ),
    )
    parser.add_argument(
        "--agent",
        type=str,
        required=True,
        help="Name of the agent to optimize (must exist as <opencode-cfg>/agents/<agent>.md).",
    )
    parser.add_argument(
        "--eval-criteria",
        type=Path,
        required=True,
        help="Path to the rubric file used by the judge LM.",
    )
    parser.add_argument(
        "--proxy-url",
        type=str,
        default="http://localhost:8080",
        help="Base URL of the openai-oc-proxy (default: http://localhost:8080).",
    )
    parser.add_argument(
        "--model",
        type=str,
        required=True,
        help="Model ID in providerID/modelID format (e.g. anthropic/claude-sonnet-4-5-20250929).",
    )
    parser.add_argument(
        "--judge-model",
        type=str,
        default="eval-model",
        help="LiteLLM model string for the judge LM (default: ollama_chat/eval-model).",
    )
    parser.add_argument(
        "--reflection-model",
        type=str,
        default="eval-model",
        help="LiteLLM model string for the GEPA reflection LM (default: ollama_chat/eval-model).",
    )
    parser.add_argument(
        "--ollama-host",
        type=str,
        default="http://localhost:11434",
        help="Ollama host URL for judge and reflection LMs (default: http://localhost:11434).",
    )
    parser.add_argument(
        "--num-threads",
        type=int,
        default=None,
        help="Parallel evaluation threads (default: let GEPA decide).",
    )
    parser.add_argument(
        "--auto",
        type=str,
        default="light",
        choices=["light", "medium", "heavy"],
        help="GEPA auto-budget preset (default: light).",
    )
    args = parser.parse_args()

    # --- Validate inputs ---
    opencode_cfg = args.opencode_cfg.resolve()
    if not opencode_cfg.is_dir():
        print(f"[error] --opencode-cfg does not exist: {opencode_cfg}", file=sys.stderr)
        return 1

    agent_file = opencode_cfg / "agents" / f"{args.agent}.md"
    if not agent_file.exists():
        print(f"[error] Agent file not found: {agent_file}", file=sys.stderr)
        return 1

    eval_criteria = args.eval_criteria.read_text(encoding="utf-8")

    # Read frontmatter now — needed only for the final write-back.
    agent_text = agent_file.read_text(encoding="utf-8")
    frontmatter, initial_instructions = split_frontmatter(agent_text)

    # --- Configure DSPy ---
    # Global default LM (used by GEPA internals when no context is set).
    dspy.configure(
        lm=dspy.LM(
            f"ollama_chat/{args.judge_model}",
            api_base=args.ollama_host,
        )
    )

    judge_lm = dspy.LM(
        f"ollama_chat/{args.judge_model}",
        api_base=args.ollama_host,
    )
    reflection_lm = dspy.LM(
        f"ollama_chat/{args.reflection_model}",
        api_base=args.ollama_host,
        temperature=1.0,
    )

    # --- Student ---
    student = OpencodeAgent(
        opencode_cfg=opencode_cfg,
        agent_name=args.agent,
        initial_instructions=initial_instructions,
        proxy_url=args.proxy_url,
        model=args.model,
    )

    # --- Trainset ---
    scenarios = list(args.scenario)
    print(f"[harness] {len(scenarios)} scenario(s) registered:", file=sys.stderr)
    trainset = []
    for s in scenarios:
        task = Path(s["task_prompt_path"]).read_text(encoding="utf-8")
        ex = dspy.Example(task=task, workdir=s["workdir"]).with_inputs(
            "task", "workdir"
        )
        trainset.append(ex)
        print(
            f"  - task={s['task_prompt_path']}  workdir={s['workdir']}",
            file=sys.stderr,
        )

    # --- Metric ---
    metric = make_metric(eval_criteria=eval_criteria, judge_lm=judge_lm)

    # --- GEPA ---
    optimizer = dspy.GEPA(
        metric=metric,
        reflection_lm=reflection_lm,
        instruction_proposer=MethodologyProposer(eval_criteria=eval_criteria),
        auto=args.auto,
        track_stats=True,
        **({"num_threads": args.num_threads} if args.num_threads is not None else {}),
    )

    print("[harness] Running dspy.GEPA optimization...", file=sys.stderr)
    optimized = optimizer.compile(student, trainset=trainset)

    # --- Write the winning prompt body back to the agent file ---
    final_body = optimized.execute.signature.instructions
    write_with_frontmatter(agent_file, frontmatter, final_body)
    print(f"[harness] Optimized prompt written to {agent_file}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
