# My Mate Dual Video Product Alignment

This document combines the two Bilibili reference videos into one product
reading:

- front-of-house product demo:
  - `https://www.bilibili.com/video/BV1p67D6fE6n/`
- back-of-house orchestration/runtime review:
  - `https://www.bilibili.com/video/BV1cuJH6LEvU/`

The earlier review in
[`docs/10-bilibili-reference-video-review.md`](/C:/project/my-mate/docs/10-bilibili-reference-video-review.md)
focused mainly on the front-stage product shell.

This document adds the missing second half:

- what kind of runtime model sits behind that shell
- what that means for My Mate's product object
- which parts stay in P1 and which must move into P2

## Why Both Videos Matter

Looking at only the demo video leads to an incomplete conclusion:

- "make the product more conversational"
- "make the UI look more like a workspace"

Those are directionally correct, but insufficient.

The second video makes it clear that the value is not just in a prettier chat
surface.

The real value comes from a combined system:

1. a low-friction task intake experience
2. a visible orchestration workspace
3. a durable machine-readable orchestration contract
4. a runtime that can monitor, parallelize, checkpoint, and recover

So the product is not just `chat`.
It is not just `run control`.
It is a `mission workspace` above a live orchestration runtime.

## What The Demo Video Contributes

`BV1p67D6fE6n` contributes the front-stage product signals.

Key signals:

- the task is the first thing on screen
- the user is not forced through a configuration wizard
- the center of gravity is a working surface, not a form
- the right rail reads like a conversational event stream
- deliverables appear during the task, not only at the end

This gives My Mate three strong product lessons:

1. `Task` beats `template` as the visible object
2. `workspace` beats `card feed` as the main surface
3. `deliverables in progress` beat `status telemetry` as the trust surface

## What The Orchestration Video Contributes

`BV1cuJH6LEvU` contributes the back-stage orchestration signals.

Key signals:

- long-running tasks are the target, not only short request-response loops
- structured orchestration spec matters enough to be treated as a core interface
- multiple pipelines can run in parallel
- monitoring cadence, signal release, and cost are first-class concerns
- the orchestrator's job is continuous steering, not only initial planning

This corrects a common mistake:

it is not enough to make the planner reply more naturally.

The product also needs a durable contract above execution:

- what the mission is
- what pipelines exist
- what checkpoints gate progress
- what outputs are expected
- what can be resumed or revised

## Combined Product Model

Taken together, the two videos point to this model.

### 1. Mission is the primary user-facing object

The user-facing object should not stop at `Run`.
It should also not stop at `Session`.

The right top-level object is closer to:

- `Mission`
- `Task Workspace`
- `Orchestration Workspace`

`Session` remains important, but as the conversational rail inside the Mission.
`Run` remains important, but as an executable instance inside the Mission.

### 2. Conversation is the control rail

Conversation is still critical, but it should not be the whole product.

The conversation rail is where the user:

- states intent
- clarifies constraints
- answers questions
- approves direction
- intervenes during runtime
- reads orchestrator explanations

That makes conversation the control channel and the human-readable audit record.

### 3. MissionSpec is the durable orchestration contract

The system needs a stable machine-facing contract that sits above:

- planner recommendation cards
- revision cards
- ad hoc intervention notes

Call it `MissionSpec`, `OrchestrationSpec`, or `MissionPlan`.

It should hold the durable shape of the job:

- mission objective
- constraints
- selected route
- work packages / pipelines
- checkpoints
- expected outputs
- current revision lineage

Without this layer, the product keeps collapsing back into "a thread with cards".

### 4. Workspace is the primary surface

The center of the product should continuously project:

- current objective
- active pipelines
- work packages
- pending decisions
- checkpoints
- generated outputs
- execution snapshots

This workspace should feel persistent even as the conversation continues.

### 5. Runtime steering is a first-class capability

Once a mission is running, the orchestrator should be able to:

- pause and resume
- change parallelism
- insert or skip work
- ask for confirmation at checkpoints
- surface cost / monitoring / progress summaries

This is the part that separates a real orchestration product from a planning UI.

## What This Means For My Mate

The current repository is not wasted.
In fact, several important foundations are already correct:

- session-first APIs
- orchestrator interpretation on message append
- structured workspace state
- run projection back into the thread
- intervention capture
- patch proposal model
- OpenClaw execution adapter path

But the exposed product still over-centers the thread.

## Main Gaps Against The Combined Model

### 1. Session is still too close to the top-level product object

Today the user mostly experiences:

- a thread
- cards inside the thread
- actions triggered from the thread

The missing lift is:

- Mission above Session

### 2. The center workspace is still card-derived

The middle area is more legible than before, but it is still mostly a
projection of message/evidence cards.

The target is stronger:

- a persistent orchestration workspace
- not merely a better-organized evidence feed

### 3. There is no durable MissionSpec layer yet

There are revisions, plan options, run plans, and patch proposals.

But there is not yet one durable product contract that says:

- "this is the current mission shape"
- "these are the current pipelines"
- "these are the accepted checkpoints and outputs"

### 4. Runtime steering is only partially real

Intervention capture exists.
Patch proposal exists.
Live apply exists for `pause_for_replan` and `skip_node`.

But the stronger runtime behaviors from the orchestration video are still
missing:

- live parallelism change
- live node insertion
- resume with patch
- checkpoint-aware runtime steering

### 5. Outputs and snapshots are not yet first-class enough

The current product still explains the work more than it shows the work.

The target experience should foreground:

- draft outputs
- branch outputs
- checkpoint snapshots
- pipeline progress

## Scope Split: P1 vs P2

To keep the roadmap honest:

### Still belongs to P1

- lift `Session` into a higher-level `Mission` shell
- treat conversation as a rail, not the full product
- add a durable `MissionSpec` or equivalent read model
- make the workspace persistent and mission-first
- promote outputs, checkpoints, and work packages into the main surface
- keep raw cards and evidence secondary

This is still product-shell work, not runtime mutation.

### Must belong to P2

- real runtime parallelism changes
- runtime node insertion
- runtime resume-with-patch
- checkpoint-aware execution steering
- deeper monitoring, cost, and signal control

This is the runtime productization work.

## Shortest Path With Current Architecture

The shortest path does not replace OpenClaw.

It re-frames the product above the current foundation.

### Step 1: keep Session as the conversational rail

Do not throw away the current Session APIs.

Instead:

- keep Session as the message and audit object
- stop treating it as the full product shell

### Step 2: add a Mission-shaped read model above Session

Introduce a higher-level object that can own:

- title / objective
- mission status
- current spec summary
- active pipelines
- latest outputs
- linked sessions and runs

This can start as a projection layer and does not need a full new engine on day
one.

### Step 3: promote MissionSpec into the orchestration core

The current revision / option / patch structures should converge into a more
durable contract.

That contract becomes the source for:

- workspace projection
- confirmation state
- runtime steering targets

### Step 4: make the mobile shell workspace-first

The main screen should read as:

- mission header / stage rail
- central orchestration workspace
- right-side conversation record
- bottom floating composer

### Step 5: extend runtime patch apply

Only after the Mission shell and MissionSpec exist should the next runtime
patches be pushed through:

- `change_parallelism`
- `add_node`
- `resume_with_patch`

## Practical Conclusion

The combined reading is:

- the current direction away from run-first was correct
- the first correction to session-first was also useful
- but the next correction is now required

That correction is:

- from `session/thread-first`
- to `mission/workspace/spec-first`

Conversation remains essential.
OpenClaw remains useful.
Run remains real.

But the product that the user should feel is:

- a mission workspace with a live orchestrator

not:

- a chat thread with planning cards
