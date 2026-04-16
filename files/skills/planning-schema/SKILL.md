---
name: planning-schema
description: Phase types, field schemas, and naming conventions for writing executable plans in TOML format.
---

## web-search
Researches external sources. Informs discussion and decision gates. This phase type does *not* satisfy pre-work web search. It is strictly for informing discussion and decisions.
```toml
[[phases]]
id = <phase-id>           # unique descriptive identifier (required)
type = "web-search"       # phase type (required)
next = [<child-id>]       # next phase ids (required) -- use [] for leaf/exit phases
questions = ["...", ...]  # research questions (required)
```

## user-discussion
Engages the user in open-ended discussion. Linear — no branching.
```toml
[[phases]]
id = <phase-id>           # unique descriptive identifier (required)
type = "user-discussion"  # phase type (required)
next = [<child-id>]       # next phase ids (required) -- use [] for leaf/exit phases
topic = "..."             # discussion topic or goal (required)
```

## user-decision-gate
Alternative to `user-discussion`. Use instead of `user-discussion` when branching is necessary.
```toml
[[phases]]
id = <phase-id>                         # unique descriptive identifier (required)
type = "user-decision-gate"             # phase type (required)
next = [<branch-a>, <branch-b>, ...]    # branch phase ids (required) -- must have 2 or more
question = "..."                        # question to present to the user (required)
```

## agentic-decision-gate
Executor decides between branches based on evidence.
```toml
[[phases]]
id = <phase-id>                         # unique descriptive identifier (required)
type = "agentic-decision-gate"          # phase type (required)
next = [<branch-a>, <branch-b>, ...]    # branch phase ids (required) -- must have 2 or more
question = "..."                        # decision question for the executor to answer from evidence (required)
```

## implement-code
Researches, implements, verifies, and retries a code goal. Junior-dev handles the full cycle — implementation, running builds/tests, and all triage — in a `work → [triage] × 5` chain. Failure after all retries exits the plan.

Provide comprehensive instructions for both work and verification. *Always* include references to pre-work steps in the `*-instructions` fields — this provides continuity between steps and gives junior-dev the context to perform its own web searches as it works.

This is especially relevant when working with external dependencies/resources. The instructions should include:

- external dependencies involved
- web searches junior-dev should perform as it works, in addition to the pre-work web research (never assume the orchestrating agent will relay this on its own)

```toml
[[phases]]
id = <phase-id>                            # unique descriptive identifier (required)
type = "implement-code"                    # phase type (required)
next = [<child-id>]                        # next phase ids (required) -- use [] for leaf/exit phases
project-survey-topics = ["...", ...]       # codebase areas to survey as a high-level overview before work (optional)
web-search-questions = ["...", ...]        # work-related web research, e.g. user docs, APIs, etc. (optional) -- required if work involves external dependencies
deep-search-questions = ["...", ...]       # codebase search and analysis before work (optional)
pre-work-project-setup-instructions = ["...", ...]  # project setup steps to run before work (optional)
work-instructions = "..."                  # detailed instructions for completing the work (required) -- include references to pre-work steps, external deps, and web searches junior-dev should run
verification-instructions = "..."         # success criteria (required) -- what junior-dev must verify after implementing: compilation, test output, visual checks, API responses, etc.
commit = false                             # commit after successful verify (optional) -- default false
```

## author-documentation
Delegates a documentation goal to documentation-expert. Single node, no retry loop. Use for writing, updating, or restructuring docs — not for any code changes.

```toml
[[phases]]
id = <phase-id>                            # unique descriptive identifier (required)
type = "author-documentation"             # phase type (required)
next = [<child-id>]                        # next phase ids (required) -- use [] for leaf/exit phases
goal = "..."                               # documentation goal (required) -- what to write, update, or restructure
commit = false                             # commit after completion (optional) -- default false
```

## write-notes
Documents findings, decisions, and context. Use as a checkpoint or leaf.
```toml
[[phases]]
id = <phase-id>           # unique descriptive identifier (required)
type = "write-notes"      # phase type (required)
next = []                 # next phase ids (required) -- use [] for leaf/exit phases
context = "..."           # what to document (optional)
```

## early-exit
A valid planned stopping point. Documents context and hands off to a future session.
```toml
[[phases]]
id = <phase-id>           # unique descriptive identifier (required)
type = "early-exit"       # phase type (required)
next = []                 # always a leaf -- early-exit never continues
reason = "..."            # reason for stopping (optional)
```

