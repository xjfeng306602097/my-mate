# Studio Rendering and Session Performance

Status: Task switching hot path optimized; broader component migration remains staged.

## Performance budget

Task navigation on a local desktop deployment should meet these budgets:

- immediate selection and loading feedback: under 50 ms;
- uncached primary Task content: under 500 ms;
- cached primary Task content: under 50 ms;
- secondary compare, proposal, trace, scorecard, and evaluation hydration: under 1 second;
- zero full-root renders during an in-place Task-to-Task switch;
- zero full-root renders and zero Session rehydration requests during a Task
  reassignment between Workspaces;
- the last selected Task always wins when requests overlap.

## Root causes found

The original implementation combined two expensive patterns.

On the server, one `GET /api/sessions/:sessionId` request rebuilt the same Session
Summary and Mission Projection through several nested helpers. Each rebuild read
linked Runs and messages and materialized the Mission contract again. The route
also repeated artifact, approval, and human-input reads already performed by the
workspace builder.

On the client, Task switching waited for multiple layers before showing the new
Task:

1. Session Detail and Route Compare.
2. Runtime Projection, Trace, Scorecards, and Evaluations.
3. DAG Proposal list and selected Proposal detail.
4. A separate artifact request.

Every loading and completion transition then called the global `render()`
function, which replaced the entire `#root` HTML tree.

## Implemented architecture

### Control Plane

- A Session Summary is built once per detail request and passed through Mission,
  Run selection, next-action, and workspace builders.
- Mission Detail reuses the MissionSpec and Mission Snapshot already present in
  the Summary instead of materializing them again.
- Artifacts, pending approvals, and pending human inputs are computed once by the
  workspace builder and returned directly by the route.

### Studio data flow

- A new Task selection aborts the previous Task request.
- The primary Session Detail is the only blocking request.
- Route Compare, DAG Proposals, Trace, Scorecards, and Evaluations hydrate in the
  background after primary content is visible.
- Runtime Projection and artifacts already included in Session Detail are not
  requested a second time.
- A two-minute stale-while-revalidate memory cache provides immediate back and
  forward Task navigation. Cached data is always revalidated in the background.
- Sequence checks and `AbortController` prevent an older response from replacing
  the last selected Task.

### Studio rendering

- Task-to-Task navigation no longer calls the global root renderer.
- Sidebar, navigation, global modal roots, and the application shell remain
  mounted.
- Only Task header state, alerts, the center workspace, and conversation rail are
  updated.
- A small pending state provides immediate visual feedback while uncached primary
  content loads.
- Session stream updates use the same Task-scoped renderer.
- Development-only counters expose full-root renders, Task-scoped renders, main
  content latency, and secondary hydration latency through the document root.
- Task reassignment merges the Desktop mutation response into the Session,
  Binding, Task Workspace, Project inventory, and cache in memory. It redraws
  only the Workspace tree and visible local-file browser.
- The Task move metric records duration, `fullRenderDelta`, and
  `taskSurfaceRenderDelta`; both render deltas are expected to be zero. The
  matching `workspace.updated` event is merged without rebuilding the Task
  workboard or conversation rail.

## Observed results

Measured on 2026-07-13 with the existing provider UI data set:

| Measurement | Before | After |
| --- | ---: | ---: |
| Session Detail | about 3.9 s | about 311 ms average |
| Route Compare | about 627 ms | about 27 ms average |
| DAG Proposal list | about 782 ms | about 22 ms average |
| Uncached Task main content | about 3-5 s | 218-314 ms typical |
| Cached Task main content | not available | 3 ms observed |
| Rapid final-selection main content | stale-response risk | 76 ms observed |
| Full-root renders during Task switch | multiple | 0 |

## Framework decision

React, Vue, or another component framework remains a valid destination, but an
immediate framework rewrite is not the performance fix itself. The current Studio
contains substantial workflow authoring, runtime graph, setup, governance, diff,
and conversation behavior in one module. Migrating all of it before defining data
and rendering boundaries would combine a product rewrite with a performance fix.

The safer migration path is:

1. Keep extracting API clients, view models, and renderable surfaces from
   `app.js`.
2. Move Task Workspace, Sidebar Inventory, Conversation Rail, Runtime Graph, and
   Change Review behind explicit component contracts.
3. Introduce a framework build pipeline only after these contracts have focused
   tests and no longer depend on implicit global render side effects.
4. Migrate one surface at a time while retaining the existing Gateway and Control
   Plane contracts.

## Remaining work

- Replace the remaining global render calls outside Task switching with scoped
  renderers or framework components.
- Add list virtualization when Task, evidence, message, or runtime-node counts
  exceed the current bounded UI assumptions.
- Split `app.js` into API, state, navigation, Task, Inbox, Library, Settings, and
  Advanced surface modules.
- Add server projection versioning and ETag support for larger Session and Run
  responses.
- Add continuous browser performance gates for uncached, cached, and rapid-switch
  scenarios on representative data sets.
