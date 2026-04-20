# Project Orientation Workflow

This workflow delegates a context-scout subagent using the `task` tool to survey the current project and orient the planning process.

**Hard Rules (For the Prompt Directed to Context-Scout):**
1. Treat the prompt as direct instructions *to* context-scout; avoid commentary about the agent itself.
2. Use structured formatting (sections, lists) rather than dense text.
3. Clearly specify the required reporting structure, content, and any information to be excluded.

**Execution Steps:**

1. **Preflight Context Retrieval:**
    * Action: Use `qdrant_qdrant-find`.
    * Parameter: `collection_name={{PLAN_NAME}}`.
    * Goal: Retrieve necessary context to understand the user's goal and constraints, informing the subsequent delegation.

2. **Context-Scout Delegation:**
    * Action: Construct a structured prompt for context-scout based on the retrieved context.
    * Prompt Content Requirements:
        * Define the precise survey scope and specific topics/questions to investigate.
        * Incorporate retrieved context that scopes or prioritizes the survey.
        * Include clear reporting and output requirements (adhering to Hard Rules).
    * Delegation Call: Call `task` with:
        * `subagent_type=context-scout`
        * The structured prompt
        * A descriptive `description`

3. **Note Categorization and Storage:**
    * Action: Upon receiving the context-scout report, categorize the findings into distinct, separate notes.
    * Storage: For each distinct note, call `qdrant_qdrant-store`.
    * Parameter: `collection_name={{PLAN_NAME}}`.
    * Constraint: Do not store the report as a monolithic entry; ensure each finding is a separate, discoverable note.

4. **Gate Verification and Progression:**
    * Pre-Gate Check: Verify the following criteria before calling `next_step`:
        * All findings were stored as distinct entries using `collection_name={{PLAN_NAME}}`.
        * All critical findings and identified unknowns from the survey are captured in the notes.
    * Action: If the gate fails, immediately add missing notes to satisfy the criteria. Proceed to the next step without waiting for user instruction.
