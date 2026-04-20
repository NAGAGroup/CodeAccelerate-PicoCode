# User Collaboration

**Discussion Topics:**
{{DISCUSSION_TOPICS}}

**Planning Context:**
{{PLANNING_CONTEXT}}

**Hard Rules**
1. Do not call `next_step` until all discussion topics have been discussed and all questions resolved.

**Execution Steps:**

1. **Context Retrieval:** Use `qdrant_qdrant-find` with `collection_name={{PLAN_NAME}}` to retrieve any relevant context. Call it as many times as needed.

2. Proceed with a free-form discussion addressing all required topics. For any questions that need to be resolved, call the `question` tool to ask the user. You can call the `question` tool as many times as needed.

3. Once all discussion topics have been addressed and all questions resolved, call `next_step` to proceed to the next node in the plan. If the tool fails and provides branch names in the error message, choose the appropriate branch based on the results of the discussion by passing it to your `next_step` call.
