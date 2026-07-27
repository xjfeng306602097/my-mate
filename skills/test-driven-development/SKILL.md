# Test Driven Development

1. Define one externally observable behavior.
2. Add the smallest test that fails for the intended reason.
3. Implement the minimum coherent production change.
4. Run focused tests, then the affected regression suite.
5. Refactor only while tests remain green and report exact verification.
6. Use stable idempotency keys for every edit and command; on resume, inspect `workspace_status` before continuing.
7. Leave all edits in the sandbox for final Change Set review.
