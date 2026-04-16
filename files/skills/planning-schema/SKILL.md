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

## work
Researches, implements, and verifies a goal. Includes automatic retries on failure. Provide comprehensive instructions for both work and verification. *Always* include references to pre-work steps in the `*-instructions` fields, this helps provide continuity between steps.

This is especially relevant when working with external dependencies/resources as it gives tailwrench, junior-dev and documentation-expert subagents delegated at these steps the required context to perform their own web searches in addition to the pre-work web research if needed. The instructions should include:

- external dependencies involved
- web searches that tailwrench/junior-dev/documentation-expert should perform as they work, in addition to the pre-work web research (never assume that the orchestrating agent will provide this info on their own)

```toml
[[phases]]
id = <phase-id>                            # unique descriptive identifier (required)
type = "work"                              # phase type (required)
next = [<child-id>]                        # next phase ids (required) -- use [] for leaf/exit phases
work-type = "code"                         # implementation type (required) -- "code" or "docs"
project-survey-topics = ["...", ...]       # codebase areas to survey as a high-level overview before work (required)
web-search-questions = ["...", ...]   # work-related web research, e.g. user docs, APIs, etc. (optional) -- required for every work phase if work involves external dependencies
deep-search-questions = ["...", ...]  # codebase search and analysis before work (required)
pre-work-project-setup-instructions = ["...", ...]   # project setup instructions to complete before work (optional) -- required if project setup is necessary for the work phase, include references to web research and codebase search as needed
work-instructions = "..."    # detailed instructions for completing the work (required) -- include references to project survey, web research, codebase search, and project setup
verification-instructions = "..."                 # success criteria (required) -- ensures the work was completed successfully via tailwrench, includes compilation, checking against external resources, running tests, visual checks, etc.
commit = false                             # commit after successful verify (optional) -- default false
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

