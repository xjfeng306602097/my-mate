# Long-Term Memory Policy And Tools

Status: M2 implemented

## Capability boundary

Long-term memory is exposed through the bundled `memory.core` plugin. The
Conversation loop does not contain memory-specific execution branches. Tool
schemas, risk, progress, execution, and audit all flow through the Capability
Registry and Conversation Action path.

The model-visible tools are:

- `memory_search`: reads active non-restricted memory in the current Workspace;
- `memory_remember`: stores or proposes durable information;
- `memory_forget`: soft-deletes or proposes deletion of one memory id.

Every committed or proposed memory written by the plugin records the source
Session, user message, and Conversation Action id.

## Policy matrix

| Mode | Explicit remember | Inferred low risk | Inferred medium/high risk | Explicit forget | Inferred forget |
|---|---|---|---|---|---|
| Review First | Stage | Stage | Stage | Stage | Stage |
| Assisted | Commit | Stage | Stage | Commit | Stage |
| Autopilot | Commit | Commit | Stage | Commit | Stage |

Restricted memory always stages. A normal inferred fact with confidence below
`0.85`, a private memory, a decision, or a lesson is not considered low risk.
Deletion is always high risk, and an inferred deletion never commits directly.

The server derives explicit intent from the latest user message. The model does
not get to declare an inferred write as explicit in tool arguments.

## Privacy and safety

- Workspace scope is fixed to the active Workspace.
- User scope is fixed to the authenticated principal for model tools.
- Project and Agent scopes require an explicit scope id.
- Restricted memory is never returned to the model.
- Private memory is returned only for the authenticated user scope.
- Exact active duplicates return the existing memory id instead of writing.
- Credential-shaped content is rejected by the canonical store.
- Pending review is reported distinctly from a committed mutation.

## Candidate operations

`MemoryCandidateRecord` now supports `create`, `update`, and `delete` operations.
Approval applies the proposed operation and links the resulting memory id. If
the candidate record cannot be finalized, the store compensates the memory
write so the candidate and canonical record cannot report contradictory
success.

## Remaining work

- surface memory candidates in the Studio Inbox and Memory Center;
- build frozen Core Memory snapshots for new Sessions;
- add Session Recall and hybrid retrieval;
- add background review hooks and candidate notifications;
- add Task Checkpoint persistence and automatic continuation.
