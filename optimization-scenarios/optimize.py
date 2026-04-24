#!/usr/bin/env python3
"""
GEPA prompt optimization harness (direct gepa, no DSPy).

Optimizes the body of `--optimized-prompt` against a static scenario
(`--static-prompt`, `--agent`) using an LM-as-a-judge rubric
(`--eval-criteria`). The file's frontmatter is preserved across all writes.

Flow per candidate:
  1. write `frontmatter + candidate["prompt"]` to the optimized prompt file
  2. run opencode in --workdir, capture its output
  3. judge the output via ollama and return (score, feedback)
  4. gepa reflects on (trajectory, score, feedback) and proposes the next candidate

Both the judge and the reflection LM run via ollama (default localhost:11434).

Dependencies:  gepa  ollama
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import gepa
import ollama
from gepa.core.adapter import EvaluationBatch, GEPAAdapter


# ======================================================================
# JSON helpers — judge sometimes wraps output in ```json fences
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
    static_prompt_path: Path,
    agent: str,
) -> str:
    with open(static_prompt_path, "r") as file:
        prompt = file.read()
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
            agent,
            prompt,
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
# Judge
# ======================================================================


_JUDGE_SYSTEM_PROMPT = """You are evaluating the output of an AI agent against a rubric.

**Input:**
    - Evaluation criteria
    - Json formatted log of the agent's session that is being evaluated

**Output:**

```json
{
  "score": <float between 0.0 and 1.0>,
  "feedback": "<detailed textual rationale citing concrete aspects of the output against specific rubric criteria>"
}
```
"""


def judge(
    client: ollama.Client,
    model: str,
    eval_criteria: str,
    agent_output: str,
) -> tuple[float, str]:
    user_msg = (
        "Evaluate the agent output against the rubric. Respond with JSON only "
        "(keys *must* match: 'score', 'feedback').\n\n"
        f"**Evaluation criteria:**\n\n{eval_criteria}\n\n"
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
    Treats the optimized prompt file as the only evolvable component.

    candidate schema:  {"prompt": "<body of the optimized prompt file>"}
    batch element schema:  {"static_prompt_path": str, "agent": str}
    """

    def __init__(
        self,
        workdir: Path,
        optimized_path: Path,
        frontmatter: str,
        eval_criteria: str,
        judge_client: ollama.Client,
        judge_model: str,
    ):
        self._workdir = workdir
        self._optimized_path = optimized_path
        self._frontmatter = frontmatter
        self._eval_criteria = eval_criteria
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
        write_with_frontmatter(self._optimized_path, self._frontmatter, body)

        outputs, scores, trajectories = [], [], []
        for example in batch:
            static_prompt_path = Path(example["static_prompt_path"])
            agent = example["agent"]

            transcript = run_opencode(
                workdir=self._workdir,
                static_prompt_path=static_prompt_path,
                agent=agent,
            )
            score, feedback = judge(
                client=self._judge_client,
                model=self._judge_model,
                eval_criteria=self._eval_criteria,
                agent_output=transcript,
            )

            outputs.append(transcript)
            scores.append(score)
            if capture_traces:
                trajectories.append(
                    {
                        "static_prompt_path": str(static_prompt_path),
                        "agent": agent,
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
                with open(traj["static_prompt_path"], "r") as f:
                    scenario_prompt = f.read()
                CONSTRAINT = (
                    "\n\n---\n"
                    "**Rules on Proposed Prompt:**\n"
                    "- Always keep your proposed changes free of any domain-specific or task-specific language "
                    "(programming languages, build systems, specific shell tools, "
                    "library names, file extensions, etc. are *banned* from your proposed changes).\n"
                    "- Instead, keep the prompt focused on methodology: tool usage, information "
                    "gathering, completeness, recovery from failures, reporting discipline.\n"
                    "- The prompt must remain applicable across arbitrary task domains."
                )

                rows.append(
                    {
                        "Inputs": {...},
                        "Generated Outputs": traj["transcript"],
                        "Feedback": (
                            f"{CONSTRAINT}"
                            f"Score: {score:.3f}\n\n"
                            f"Rubric-based feedback:\n{traj['feedback']}"
                        ),
                    }
                )
            reflective[component] = rows
        return reflective


# ======================================================================
# Main
# ======================================================================


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workdir",
        type=Path,
        required=True,
        help="Directory in which to launch opencode",
    )
    parser.add_argument(
        "--static-prompt",
        type=Path,
        required=True,
        help="Path to the fixed scenario prompt file",
    )
    parser.add_argument(
        "--optimized-prompt",
        type=Path,
        required=True,
        help="Path to the prompt file being optimized (rewritten in place)",
    )
    parser.add_argument(
        "--eval-criteria",
        type=Path,
        required=True,
        help="Path to the rubric file used by the judge",
    )
    parser.add_argument(
        "--agent", type=str, required=True, help="Agent name passed through to opencode"
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
        help="Ollama model name for GEPA's reflection LM (passed as ollama_chat/<name>)",
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
    optimized_text = args.optimized_prompt.read_text(encoding="utf-8")
    frontmatter, initial_body = split_frontmatter(optimized_text)

    # --- Judge client ---
    judge_client = ollama.Client(host=args.ollama_host)

    # --- Adapter ---
    adapter = OpencodeAdapter(
        workdir=args.workdir,
        optimized_path=args.optimized_prompt,
        frontmatter=frontmatter,
        eval_criteria=eval_criteria,
        judge_client=judge_client,
        judge_model=args.judge_model,
    )

    # --- Trainset (single scenario) ---
    trainset = [
        {
            "static_prompt_path": str(args.static_prompt),
            "agent": args.agent,
        }
    ]

    # --- Seed candidate ---
    seed_candidate = {"prompt": initial_body}

    # --- Reflection LM: LiteLLM-style string routed through ollama ---
    # gepa uses LiteLLM under the hood; ollama_chat/<model> hits the
    # local ollama server. api_base is picked up from OLLAMA_HOST / default.
    os.environ.setdefault("OLLAMA_API_BASE", args.ollama_host)
    reflection_lm = f"ollama_chat/{args.reflection_model}"

    print("[harness] Running GEPA optimization...", file=sys.stderr)
    result = gepa.optimize(
        seed_candidate=seed_candidate,
        trainset=trainset,
        adapter=adapter,
        reflection_lm=reflection_lm,
        max_metric_calls=args.max_metric_calls,
        display_progress_bar=True,
    )

    # --- Persist final best body ---
    best = result.best_candidate["prompt"]
    write_with_frontmatter(args.optimized_prompt, frontmatter, best)
    print(
        f"[harness] Final optimized prompt written to {args.optimized_prompt}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
