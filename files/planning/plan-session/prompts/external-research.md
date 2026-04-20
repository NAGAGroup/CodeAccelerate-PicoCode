Execute the following external research protocol to inform planning decisions for the project identified by `{{PLAN_NAME}}`.

**Phase 1: Preflight and Assessment**
1.  **Retrieve Context:** Use the `qdrant_qdrant-find` tool with `collection_name={{PLAN_NAME}}` to retrieve the user's established goal, constraints, and orientation findings.
2.  **Determine Need:** Assess whether external research is necessary to fill knowledge gaps or inform high-level planning decisions, based on the retrieved context.

**Phase 2: Execution Path**
*   **If Research is NOT Needed:** Confirm with the user that no research is required, and then immediately call the `task` tool instructing `external-scout` to return immediately.
*   **If Research IS Needed:**
    1.  **Construct Prompt:** Create a single, highly structured prompt for `external-scout`. This prompt must explicitly define:
        *   The specific research questions and topics required.
        *   The project constraints that the findings must adhere to.
        *   A summary of prior findings (from Phase 1) to prevent duplication.
        *   Strict reporting requirements (structure, required content, and specific items to exclude).
    2.  **Delegate Task:** Call the `task` tool with `subagent_type=external-scout`, the structured prompt, and a descriptive summary.

**Phase 3: Post-Processing and Gatekeeping**
1.  **Note Categorization:** Upon receiving the `external-scout` report, categorize the findings into distinct, actionable notes.
2.  **Storage:** For each distinct note, call the `qdrant_qdrant-store` tool using `collection_name={{PLAN_NAME}}`. Do not store the report as a single, monolithic entry.
3.  **Verification Gate:** Before proceeding to the next step, verify that:
    *   All findings have been stored as distinct entries using `collection_name={{PLAN_NAME}}`.
    *   All identified findings and unknowns are captured in the notes.
    *   If the gate fails, immediately add the missing notes and proceed without waiting for user input.
