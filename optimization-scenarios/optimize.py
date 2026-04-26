#!/usr/bin/env python3
"""
GEPA prompt optimization harness (direct gepa, no DSPy).

Optimizes the body of `--agent-system-prompt` against one or more scenarios
(`--scenario task_prompt_path,workdir`, repeatable) using an LM-as-a-judge
rubric (`--eval-criteria`). The agent system prompt file's frontmatter is
preserved across all writes.

All scenarios in a single CLI invocation share the same agent system prompt
and are optimized together as one batch. They run sequentially (no
parallelism), since they all read/write the same prompt file.

Flow per candidate:
  1. write `frontmatter + candidate["prompt"]` to the agent system prompt file
  2. for each scenario: run opencode in its workdir, capture output
  3. judge each output via ollama and return (score, feedback) per scenario
  4. custom proposer reflects on the full batch and proposes the next candidate

Both the judge and the proposer run via ollama (default localhost:11434).

Dependencies:  gepa  ollama
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import gepa
import ollama
from gepa.core.adapter import EvaluationBatch, GEPAAdapter, ProposalFn


# ======================================================================
# JSON helpers — models sometimes wrap output in ```json fences
# ======================================================================


def _strip_fences(s: str) -> str:
    s = s.strip()
    if not s.startswith("```"):
        return s
    lines = s.split("\n")
    if lines[-1].strip() == "```":
        lines = lines[:-1]
    lines = lines[1:]
    return "\n".join(lines).strip()


def _extract_json(s: str) -> dict:
    s = _strip_fences(s)
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        s = s[start : end + 1]
    parsed = json.loads(s)
    if isinstance(parsed, str):
        parsed = json.loads(parsed)
    return parsed


# ======================================================================
# Opencode black box
# ======================================================================


def run_command_live(cmd: list[str]) -> tuple[str, int]:
    captured = []
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()
        captured.append(line)
    returncode = proc.wait()
    return "".join(captured), returncode


def run_opencode(
    workdir: Path,
    task_prompt: str,
    subagent: str,
) -> str:
    cwd = os.getcwd()
    os.chdir(workdir)
    try:
        subprocess.call(["git", "checkout", "."])
        subprocess.call(["git", "clean", "-Xdf", "."])
        subprocess.call(["grepai", "init", "-p", "ollama", "--yes"])
        cmd = [
            "npx",
            "opencode",
            "run",
            "--format",
            "json",
            "--thinking",
            "--agent",
            subagent,
            task_prompt,
        ]
        output, _ = run_command_live(cmd)
    finally:
        os.chdir(cwd)
    return output


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
    """
    Parse a `task_prompt_path,workdir` pair from the CLI.
    Trims whitespace; both halves required.
    """
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
# Judge
# ======================================================================


_JUDGE_SYSTEM_PROMPT = """You are evaluating the output of an AI agent against a rubric.

Always respond with raw json for the evaluation.
"""


def judge(
    client: ollama.Client,
    model: str,
    eval_criteria: str,
    agent_task: str,
    agent_output: str,
) -> tuple[float, str]:
    user_msg = (
        "Evaluate the agent output against the rubric. Respond with JSON only "
        "(keys *must* match: 'score', 'feedback').\n\n"
        f"**Evaluation criteria:**\n\n```markdown\n{eval_criteria}\n```\n\n"
        f"**Agent's Task:**\n\n{agent_task}\n\n"
        f"**Agent's session log:**\n\n```json\n{agent_output}\n```\n\n"
    )
    print(f"[judge] calling (output len={len(agent_output)})", file=sys.stderr)
    try:
        response = client.chat(
            model=model,
            messages=[
                {"role": "system", "content": _JUDGE_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            format="json",
        )
        raw = response["message"]["content"]
        print(f"[judge response]: {raw}", file=sys.stderr)
        parsed = _extract_json(raw)
        return float(parsed["score"]), str(parsed.get("feedback", ""))
    except Exception as e:
        import traceback

        print(f"[judge] FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 0.0, f"Judge error: {type(e).__name__}: {e}"


# ======================================================================
# GEPA adapter
# ======================================================================


class OpencodeAdapter(GEPAAdapter):
    """
    Treats the agent system prompt file as the only evolvable component.

    candidate schema:    {"prompt": "<body of the agent system prompt file>"}
    batch element schema:  {"task_prompt_path": str, "workdir": str}
    """

    def __init__(
        self,
        agent_system_prompt_path: Path,
        frontmatter: str,
        eval_criteria: str,
        subagent: str,
        judge_client: ollama.Client,
        judge_model: str,
    ):
        self._agent_system_prompt_path = agent_system_prompt_path
        self._frontmatter = frontmatter
        self._eval_criteria = eval_criteria
        self._subagent = subagent
        self._judge_client = judge_client
        self._judge_model = judge_model

    def evaluate(
        self,
        batch: list[dict],
        candidate: dict[str, str],
        capture_traces: bool = False,
    ) -> EvaluationBatch:
        body = candidate["prompt"]
        # Persist the candidate to disk before any run — opencode reads it.
        write_with_frontmatter(self._agent_system_prompt_path, self._frontmatter, body)

        outputs, scores, trajectories = [], [], []
        # Sequential — all scenarios share the same prompt file on disk.
        for example in batch:
            task_prompt_path = Path(example["task_prompt_path"])
            workdir = Path(example["workdir"])

            print(
                f"[adapter] scenario: task={task_prompt_path} workdir={workdir}",
                file=sys.stderr,
            )

            with open(task_prompt_path, "r") as file:
                task_prompt = file.read()

            transcript = run_opencode(
                workdir=workdir,
                task_prompt=task_prompt,
                subagent=self._subagent,
            )
            score, feedback = judge(
                client=self._judge_client,
                model=self._judge_model,
                agent_task=task_prompt,
                eval_criteria=self._eval_criteria,
                agent_output=transcript,
            )

            outputs.append(transcript)
            scores.append(score)
            if capture_traces:
                trajectories.append(
                    {
                        "task_prompt_path": str(task_prompt_path),
                        "workdir": str(workdir),
                        "candidate_prompt": body,
                        "transcript": transcript,
                        "score": score,
                        "feedback": feedback,
                    }
                )

        return EvaluationBatch(
            outputs=outputs,
            scores=scores,
            trajectories=trajectories if capture_traces else None,
        )

    def make_reflective_dataset(
        self,
        candidate: dict[str, str],
        eval_batch: EvaluationBatch,
        components_to_update: list[str],
    ) -> dict[str, list[dict]]:
        reflective = {}
        for component in components_to_update:
            rows = []
            for traj, score in zip(eval_batch.trajectories or [], eval_batch.scores):
                with open(traj["task_prompt_path"], "r") as f:
                    task_prompt = f.read()
                rows.append(
                    {
                        "Inputs": {
                            "task_prompt": task_prompt,
                            "workdir": traj["workdir"],
                        },
                        "Generated Outputs": traj["transcript"],
                        "Feedback": (
                            f"Score: {score:.3f}\n\n"
                            f"Rubric-based feedback:\n{traj['feedback']}"
                        ),
                    }
                )
            reflective[component] = rows
        return reflective


# ======================================================================
# Custom proposer — enforces methodology-only prompt revisions
# ======================================================================


_PROPOSER_SYSTEM_PROMPT = """You are improving an AI agent's system prompt based on feedback from evaluation runs.

**Your task:** Given the current prompt and a set of feedback examples, propose an improved version of the prompt.

**Prompt Revision Rules:**
- Always keep the prompt free of any domain-specific or task-specific language (e.g. programming languages, build systems, specific shell tools, library names, file extensions, framework names, etc. are *banned* from the prompt)
- Instead, the prompt should focus on methodology (e.g. tool usage, information gathering, completeness, recovery from failures, reporting discipline, etc.)
- Always keep the prompt applicable across arbitrary task domains

**Output format:** Respond with JSON only:
{
  "improved_prompt": "<the full text of the new prompt>"
}
"""


class OllamaProposer(ProposalFn):
    """
    Custom instruction proposer that enforces domain-agnostic prompt constraints.
    Uses ollama directly instead of going through LiteLLM.
    """

    def __init__(
        self,
        client: ollama.Client,
        model: str,
        max_transcript_chars: int = 2000,
    ):
        self._client = client
        self._model = model
        self._max_transcript_chars = max_transcript_chars

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
                f"{str(ex.get('Generated Outputs', ''))[: self._max_transcript_chars]}\n\n"
                f"**Feedback:**\n{ex.get('Feedback', 'No feedback')}"
                for i, ex in enumerate(examples)
            )

            user_msg = (
                f"## Current Prompt\n\n{current}\n\n"
                f"## Evaluation Feedback\n\n{feedback_block}\n\n"
                "Propose an improved version of the current prompt that addresses "
                "the feedback while strictly following the Prompt Revision Rules "
                "in your system instructions. Respond with JSON only."
            )

            try:
                response = self._client.chat(
                    model=self._model,
                    messages=[
                        {"role": "system", "content": _PROPOSER_SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    format="json",
                )
                raw = response["message"]["content"]
                print(
                    f"[proposer response]: {raw[:500]}{'...' if len(raw) > 500 else ''}",
                    file=sys.stderr,
                )
                parsed = _extract_json(raw)
                improved = parsed.get("improved_prompt")
                if isinstance(improved, str) and improved.strip():
                    updated[component] = improved
                else:
                    print(
                        "[proposer] empty/invalid improved_prompt; skipping component",
                        file=sys.stderr,
                    )
            except Exception as e:
                import traceback

                print(
                    f"[proposer] FAILED: {type(e).__name__}: {e}",
                    file=sys.stderr,
                )
                traceback.print_exc(file=sys.stderr)
                # Skip this component — gepa treats as no proposal

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
            "A scenario as a comma-separated pair: "
            "path to the task prompt file, and the workdir to launch opencode in. "
            "Repeat the flag to add more scenarios; all share the same agent "
            "system prompt and are optimized together as one batch."
        ),
    )
    parser.add_argument(
        "--agent-system-prompt",
        type=Path,
        required=True,
        help="Path to the agent system prompt file being optimized (rewritten in place)",
    )
    parser.add_argument(
        "--eval-criteria",
        type=Path,
        required=True,
        help="Path to the rubric file used by the judge",
    )
    parser.add_argument(
        "--subagent",
        type=str,
        required=True,
        help="Subagent name passed through to the opencode CLI (--agent)",
    )
    parser.add_argument(
        "--judge-model",
        type=str,
        default="eval-model",
        help="Ollama model name for the judge",
    )
    parser.add_argument(
        "--reflection-model",
        type=str,
        default="eval-model",
        help="Ollama model name for the custom proposer",
    )
    parser.add_argument(
        "--ollama-host",
        type=str,
        default="http://localhost:11434",
        help="Ollama host URL",
    )
    parser.add_argument(
        "--max-metric-calls",
        type=int,
        default=30,
        help="Budget: total number of candidate evaluations",
    )
    args = parser.parse_args()

    # --- Load files ---
    eval_criteria = args.eval_criteria.read_text(encoding="utf-8")
    optimized_text = args.agent_system_prompt.read_text(encoding="utf-8")
    frontmatter, initial_body = split_frontmatter(optimized_text)

    # --- Ollama client ---
    ollama_client = ollama.Client(host=args.ollama_host)

    # --- Adapter ---
    adapter = OpencodeAdapter(
        agent_system_prompt_path=args.agent_system_prompt,
        frontmatter=frontmatter,
        eval_criteria=eval_criteria,
        subagent=args.subagent,
        judge_client=ollama_client,
        judge_model=args.judge_model,
    )

    # --- Proposer (enforces methodology-only constraint) ---
    proposer = OllamaProposer(
        client=ollama_client,
        model=args.reflection_model,
    )

    # --- Trainset (all scenarios; sequential evaluation per candidate) ---
    trainset = list(args.scenario)
    print(
        f"[harness] {len(trainset)} scenario(s) registered:",
        file=sys.stderr,
    )
    for s in trainset:
        print(
            f"  - task={s['task_prompt_path']}  workdir={s['workdir']}",
            file=sys.stderr,
        )

    # --- Seed candidate ---
    seed_candidate = {"prompt": initial_body}

    print("[harness] Running GEPA optimization...", file=sys.stderr)
    result = gepa.optimize(
        seed_candidate=seed_candidate,
        trainset=trainset,
        adapter=adapter,
        reflection_lm=None,  # unused when candidate_proposer is provided
        custom_candidate_proposer=proposer,
        max_metric_calls=args.max_metric_calls,
        display_progress_bar=True,
    )

    # --- Persist final best body ---
    best = result.best_candidate["prompt"]
    write_with_frontmatter(args.agent_system_prompt, frontmatter, best)
    print(
        f"[harness] Final optimized prompt written to {args.agent_system_prompt}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
