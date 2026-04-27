#!/usr/bin/env python3
"""
GEPA prompt optimization harness (dspy.GEPA proper).

Optimizes the body of `--agent-system-prompt` against one or more scenarios
(`--scenario task_prompt_path,workdir`, repeatable) using an LM-as-a-judge
rubric (`--eval-criteria`). The agent system prompt file's frontmatter is
preserved across all writes.

Architecture:
  - Student is a dspy.Module with one dspy.Predict whose signature
    `.instructions` IS the agent system prompt body. GEPA mutates the
    instructions; forward() persists them to disk so opencode picks them up,
    runs opencode, and returns the transcript.
  - The predictor is invoked in forward() so DSPy's trace machinery captures
    it (required for GEPA's reflective dataset). Its output is discarded —
    the metric judges the opencode transcript, not the predictor's output.
  - The metric is an LM-as-a-judge call returning dspy.Prediction(score, feedback).
  - The instruction proposer is a ProposalFn whose docstring encodes the
    methodology-only revision rules; the body is a single dspy.ChainOfThought
    call.

All scenarios in a single CLI invocation share the same agent system prompt
and are optimized together. They run sequentially since they all touch the
same file on disk.

Dependencies:  dspy  gepa
"""

import argparse
import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path

import dspy
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


def run_opencode(workdir: Path, task_prompt: str, subagent: str) -> str:
    cwd = os.getcwd()
    tmpdir = Path(f"/tmp/{workdir}")
    shutil.copytree(workdir, tmpdir)
    os.chdir(tmpdir)
    try:
        subprocess.call(["grepai", "init", "-p", "ollama", "--yes"])
        cmd = [
            "npx",
            "opencode",
            "run",
            "--thinking",
            "--agent",
            subagent,
            task_prompt,
        ]
        output, _ = run_command_live(cmd)
    finally:
        shutil.rmtree(f"/tmp/{workdir}")
        os.chdir(cwd)

    print("\n\n[forward] Opencode finished.\n\n")
    return output


# ======================================================================
# Student: dspy.Module wrapping opencode
# ======================================================================


class _AgentSignature(dspy.Signature):
    """Placeholder — replaced via with_instructions at construction.

    The .instructions on this signature is the agent system prompt body
    that GEPA optimizes. The predictor is invoked during forward() solely
    so DSPy's trace machinery captures it; its output is discarded.
    """

    task: str = dspy.InputField(desc="The task description given to the agent")
    result: str = dspy.OutputField(desc="What the agent would do for this task")


class OpencodeAgent(dspy.Module):
    """
    Student module. Holds one dspy.Predict whose signature instructions are
    the agent system prompt body. forward() persists the current instructions
    to the agent system prompt file, runs opencode, and returns the transcript.
    """

    def __init__(
        self,
        initial_body: str,
        agent_system_prompt_path: Path,
        frontmatter: str,
        subagent: str,
    ):
        super().__init__()
        self.agent = dspy.Predict(_AgentSignature.with_instructions(initial_body))
        self._agent_system_prompt_path = agent_system_prompt_path
        self._frontmatter = frontmatter
        self._subagent = subagent

    def forward(self, task_prompt: str, workdir: str) -> dspy.Prediction:
        # Whatever GEPA has installed as the current candidate body:
        body = self.agent.signature.instructions

        # Persist to disk so opencode reads the new prompt.
        write_with_frontmatter(self._agent_system_prompt_path, self._frontmatter, body)

        print(
            f"[student] running opencode workdir={workdir}",
            file=sys.stderr,
        )
        transcript = run_opencode(
            workdir=Path(workdir),
            task_prompt=task_prompt,
            subagent=self._subagent,
        )

        # Invoke the predictor so DSPy traces it. Output is irrelevant —
        # the trace is what GEPA's reflective dataset reads from. Without
        # this call, GEPA's make_reflective_dataset finds no predictions
        # and skips the proposal.
        try:
            _ = self.agent(task=task_prompt)
        except Exception as e:
            print(
                f"[student] trace-predictor call failed (non-fatal): "
                f"{type(e).__name__}: {e}",
                file=sys.stderr,
            )

        return dspy.Prediction(transcript=transcript)


# ======================================================================
# Metric: LM-as-a-judge via ollama
# ======================================================================


class JudgeAgentOutput(dspy.Signature):
    """Evaluate an AI agent's output against a rubric.

    In your feedback, always provide both what the agent did well and where
    it could improve. Provide a breakdown of your scores with reasoning,
    citing concrete aspects of the agent's session log against specific
    rubric criteria.
    """

    eval_criteria: str = dspy.InputField(
        desc="The rubric defining the evaluation criteria"
    )
    agent_task: str = dspy.InputField(desc="The task that was given to the agent")
    agent_output: str = dspy.InputField(
        desc="The agent's session log (typically JSON-formatted)"
    )

    score: float = dspy.OutputField(
        desc="A score between 0.0 and 1.0 reflecting overall rubric performance"
    )
    feedback: str = dspy.OutputField(
        desc=(
            "Detailed textual rationale: what the agent did well, where it "
            "could improve, and a per-criterion breakdown of the score"
        )
    )


def make_metric(eval_criteria: str, judge_lm: dspy.LM):
    judge = dspy.ChainOfThought(JudgeAgentOutput)

    def metric(
        gold: dspy.Example,
        pred: dspy.Prediction,
        trace=None,
        pred_name=None,
        pred_trace=None,
    ):
        try:
            with dspy.context(lm=judge_lm):
                result = judge(
                    eval_criteria=eval_criteria,
                    agent_task=gold.task_prompt,
                    agent_output=pred.transcript,
                )
            score = float(result.score)
            feedback = str(result.feedback)
            print(
                f"[metric] score={score:.3f} feedback_len={len(feedback)}",
                file=sys.stderr,
            )
            return dspy.Prediction(score=score, feedback=feedback)
        except Exception as e:
            print(
                f"[metric] FAILED: {type(e).__name__}: {e}",
                file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            return dspy.Prediction(
                score=0.0,
                feedback=f"Judge error: {type(e).__name__}: {e}",
            )

    return metric


# ======================================================================
# Instruction proposer: ProposalFn using dspy.ChainOfThought
# ======================================================================


class ProposeImprovedPrompt(dspy.Signature):
    """Improve an AI agent's system prompt based on feedback from evaluation runs.

    Given the current prompt and a set of feedback examples, propose an
    improved version of the prompt.

    Prompt Revision Rules:
    - Always keep the prompt free of any domain-specific or task-specific language (e.g. programming languages, build systems, specific shell tools, library names, file extensions, framework names, etc. are *banned* from the prompt)
    - Instead, the prompt should focus on methodology (e.g. tool usage, information gathering, completeness, recovery from failures, reporting discipline, etc.)
    - Always keep the prompt applicable across arbitrary task domains
    """

    current_prompt: str = dspy.InputField(
        desc="The current agent system prompt that needs improvement"
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
    Custom instruction proposer. Wraps a dspy.ChainOfThought whose signature
    docstring encodes the methodology-only revision rules. Runs in the
    reflection_lm context.
    """

    def __init__(self):
        self._propose = dspy.ChainOfThought(ProposeImprovedPrompt)

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
                # dspy.GEPA invokes the proposer inside the reflection_lm
                # context, so no explicit dspy.context(lm=...) needed here.
                result = self._propose(
                    current_prompt=current,
                    feedback_examples=feedback_block,
                )
                improved = result.improved_prompt
                if isinstance(improved, str) and improved.strip():
                    updated[component] = improved
                    print(
                        f"[proposer] proposed new prompt for '{component}' "
                        f"(len={len(improved)})",
                        file=sys.stderr,
                    )
                else:
                    print(
                        f"[proposer] empty/invalid improved_prompt for "
                        f"'{component}'; skipping",
                        file=sys.stderr,
                    )
            except Exception as e:
                print(
                    f"[proposer] FAILED for '{component}': {type(e).__name__}: {e}",
                    file=sys.stderr,
                )
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
            "A scenario as a comma-separated pair: path to the task prompt "
            "file, and the workdir to launch opencode in. Repeat the flag to "
            "add more scenarios; all share the same agent system prompt."
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
        help="Ollama model name for the reflection LM",
    )
    parser.add_argument(
        "--ollama-host",
        type=str,
        default="http://localhost:11434",
        help="Ollama host URL",
    )
    parser.add_argument(
        "--auto",
        type=str,
        default="light",
        choices=["light", "medium", "heavy"],
        help="GEPA auto-budget preset",
    )
    args = parser.parse_args()

    # --- Load files ---
    eval_criteria = args.eval_criteria.read_text(encoding="utf-8")
    optimized_text = args.agent_system_prompt.read_text(encoding="utf-8")
    frontmatter, initial_body = split_frontmatter(optimized_text)

    # --- Configure DSPy ---
    # Task LM: invoked by the student's trace-predictor call. Output is
    # discarded; we just need a working LM here.
    task_lm = dspy.LM(
        f"ollama_chat/{args.judge_model}",
        api_base=args.ollama_host,
        max_tokens=8192,
    )
    dspy.configure(lm=task_lm)

    # Judge LM: scoped via dspy.context inside the metric.
    judge_lm = dspy.LM(
        f"ollama_chat/{args.judge_model}",
        api_base=args.ollama_host,
        max_tokens=8192,
    )

    # Reflection LM: GEPA invokes the proposer in this context.
    reflection_lm = dspy.LM(
        f"ollama_chat/{args.reflection_model}",
        api_base=args.ollama_host,
        temperature=1.0,
        max_tokens=32000,
    )

    # --- Student ---
    student = OpencodeAgent(
        initial_body=initial_body,
        agent_system_prompt_path=args.agent_system_prompt,
        frontmatter=frontmatter,
        subagent=args.subagent,
    )

    # --- Trainset ---
    scenarios = list(args.scenario)
    print(f"[harness] {len(scenarios)} scenario(s) registered:", file=sys.stderr)
    trainset = []
    for s in scenarios:
        task_prompt = Path(s["task_prompt_path"]).read_text(encoding="utf-8")
        ex = dspy.Example(
            task_prompt=task_prompt,
            workdir=s["workdir"],
        ).with_inputs("task_prompt", "workdir")
        trainset.append(ex)
        print(
            f"  - task={s['task_prompt_path']}  workdir={s['workdir']}",
            file=sys.stderr,
        )

    # --- Metric ---
    metric = make_metric(eval_criteria=eval_criteria, judge_lm=judge_lm)

    # --- Proposer ---
    proposer = MethodologyProposer()

    # --- GEPA ---
    optimizer = dspy.GEPA(
        metric=metric,
        auto=args.auto,
        reflection_lm=reflection_lm,
        instruction_proposer=proposer,
        track_stats=True,
        num_threads=1,
    )

    print("[harness] Running dspy.GEPA optimization...", file=sys.stderr)
    optimized = optimizer.compile(student, trainset=trainset)

    # --- Persist final best body ---
    final_body = optimized.agent.signature.instructions
    write_with_frontmatter(args.agent_system_prompt, frontmatter, final_body)
    print(
        f"[harness] Final optimized prompt written to {args.agent_system_prompt}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
