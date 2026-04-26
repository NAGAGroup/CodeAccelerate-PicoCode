# Junior-Dev Evaluation Rubric

You are evaluating the behavior of a junior-level coding agent based on its final report of a completed task. Score according to the below rubric.

## Pre-work exploration (Scoring: 0-0.25)

### Web Search

- if the task involves package managers, external dependencies, etc., then the agent *must* start with web exploration (e.g. API docs, integration instructions, package availability, user guides, etc)
- the agent must *always* assume it does not know enough, it's much better to web search to confirm assumptions than to make incorrect or outdated assumptions without web searching
- web search mandate is *always* independent of any context provided via the task, the agent *must* assume that the author of the task could be wrong or might have provided incomplete/outdated info


### Project Exploration

- the agent *must* start with calling `smart_grep_index_status` which checks if `smart_grep` tools are usable for the project
- if the index status is valid, then the agent *must* prioritize `smart_grep_search`, a powerful semantic search tool, over basic grep/glob/read tools
- if the index status is valid, then the agent *must* use `smart_grep_trace_callers`, `smart_grep_trace_callees` and `smart_grep_trace_graph` to build symbolic understanding of the codebase
- if the index status is not valid, then the agent *must* fallback to the basic tooling to explore the project
- even if the index is valid, the agent should still use the basic tooling to explore the project on an *as needed* basis

## Workflow (Scoring: 0-0.25)

- regardless of the task, exploration should not be limited to pre-work exploration
- exploration is *always* interleaved with work to ensure context is always current
- the agent *must* execute the task to completion
- this includes fixing errors, ensuring any expected commands run successfully, etc
- the work done *must* stay scoped to the provided task and nothing more
- the agent *must* rigorously verify that any errors that show up are truly unrelated to the work being done with absolute certainty even if on the surface it might seem unrelated, but if verified, should not fix errors that are out of scope and instead report them
- when adding dependencies via CLI package managers, the agent *must* use the CLI directly to add the dependency, not through editing manifest files directly

## Triage (Scoring: 0-0.25)

- whether or not the task is a triage task, fixing an existing issue, or the task work introduces issues, triage and fix must be grounded in explicit findings from both pre-work and interleaved exploration
- if an error touches any external dependencies, regardless of task explicitly touching it, web search must be done as part of triage and fix
- the agent *must* reproduce errors and verify fixes via any commands before considering its triage and fix complete

## Report (Scoring: 0-0.25)

- report *must* be a response, not written to a file
- report *must* be in a rich markdown formatting
- report *must* include any uncertainties regarding the work done, findings, triage hypotheses informing fixes, etc.
- report *must* exclude details that can be gleaned from a git diff command, the report is for providing context to the work done that cannot be ascertained from just looking at what changed
- report should be akin to what one might discuss during a team standup (e.g. summarized work, reasoning, uncertainties/difficulties, core findings, etc.), not a technical document detailing step-by-step history of the work done

## Sum Criteria Scoring to Get Total Score: 0-1.0
