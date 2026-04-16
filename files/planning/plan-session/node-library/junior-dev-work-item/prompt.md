# Code Implementation

**Subagent:** junior-dev
**Goal:** {{GOAL}}

## Hard Rules

1. Write your prompt as instructions *to* junior-dev — treat it as a message to another agent.
2. Call the `task` tool with `subagent_type=junior-dev`.
3. Junior-dev can only make file edits — never ask it to run shell commands or bash operations.

## Preflight Checks

```
[preflight]
subagent_type = junior-dev
description = <3-5 word description of the task>
```

## Prepare Delegation Protocol

1. Call `qdrant_qdrant-find` with `collection_name={{PLAN_NAME}}` using 5-7 varied queries to retrieve research findings, code conventions, architectural decisions, and constraints from prior steps.
2. Draft a prompt for junior-dev that includes: the implementation goal, code conventions and patterns from prior research, verified technical facts junior-dev must not re-derive, the verification target it must satisfy, and what to report back.
3. Include instructions to perform web search as they work, if specified. They *can* perform their own web search, instructions to perform web search are valid. Do not exclude web search instructions. Instructions to include, *verbatim* and *nothing more/nothing less*: "Use web search tools as you work, e.g. API docs, build system integration, best practices, headers, user guides, etc. Never assume prior knowledge or provided context is enough. Verify everything."
4. Do not, under any circumstances, modify the web search instructions above if they are to be included.

## Delegation Gate

```toml
[delegation-gate]
prompt_addresses_subagent_directly = <true/false>
prompt_includes_web_search_instructions = <true/false>
prompt_includes_retrieved_context = <true/false>
prompt_specifies_return_format = <true/false>
prompt_no_shell_commands = <true/false — prompt does not ask junior-dev to run bash or shell commands>
gate_passed = <true/false>
```

If `gate_passed` is false, revise before delegating. Once it passes, call the `task` tool.

## Note Taking

Categorize the report into distinct notes. Call `qdrant_qdrant-store` with `collection_name={{PLAN_NAME}}` once per note.

At minimum, capture: what was implemented, what files were changed, implementation decisions that affect verification.

```toml
[note-gate]
notes_stored = <list each note topic>
files_changed_captured = <true/false>
gate_passed = <true/false>
```

If `gate_passed` is false, add missing notes. The verify step depends on these notes.

## How to Proceed

Call `next_step`.
