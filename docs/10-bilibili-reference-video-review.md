# Bilibili Reference Video Review

This document reviews the front-stage product demo video only.

For the combined reading across both:

- `BV1p67D6fE6n` as the product-shell reference
- `BV1cuJH6LEvU` as the orchestration/runtime reference

see
[`docs/13-dual-video-product-alignment.md`](/C:/project/my-mate/docs/13-dual-video-product-alignment.md).

This document records the reverse review of the reference Bilibili video:

- URL: `https://www.bilibili.com/video/BV1p67D6fE6n/`
- title: `【Demo】用Niuma语音Agent做一个小红书图，准备参加B站AI创造公开赛，Build In Public`
- duration: about `706s`

The goal of this review is not to reproduce every spoken line. The goal is to extract the interaction model and product structure that make the demo feel agentic.

## What Was Actually Retrieved

The video page itself can be opened in a controlled browser, but full player automation is partially blocked by the site.

What was successfully retrieved:

- video metadata from the public Bilibili API
- a normal browser screenshot of the page
- Bilibili `videoshot` storyboard data
- storyboard sample frames at multiple timestamps

Artifacts:

- page screenshot: [`tmp/bilibili-page.png`](/C:/project/my-mate/tmp/bilibili-page.png)
- storyboard metadata: [`tmp/bilibili-shots/videoshot.json`](/C:/project/my-mate/tmp/bilibili-shots/videoshot.json)
- sampled frames: [`tmp/bilibili-shots/samples/manifest.json`](/C:/project/my-mate/tmp/bilibili-shots/samples/manifest.json)

## Sampling Method

Sampled timestamps:

- `0s`
- `20s`
- `60s`
- `118s`
- `179s`
- `241s`
- `359s`
- `482s`
- `600s`
- `682s`

Relevant frame files:

- [`0000.png`](/C:/project/my-mate/tmp/bilibili-shots/samples/0000.png)
- [`0020.png`](/C:/project/my-mate/tmp/bilibili-shots/samples/0020.png)
- [`0060.png`](/C:/project/my-mate/tmp/bilibili-shots/samples/0060.png)
- [`0120.png`](/C:/project/my-mate/tmp/bilibili-shots/samples/0120.png)
- [`0180.png`](/C:/project/my-mate/tmp/bilibili-shots/samples/0180.png)
- [`0240.png`](/C:/project/my-mate/tmp/bilibili-shots/samples/0240.png)
- [`0360.png`](/C:/project/my-mate/tmp/bilibili-shots/samples/0360.png)
- [`0480.png`](/C:/project/my-mate/tmp/bilibili-shots/samples/0480.png)
- [`0600.png`](/C:/project/my-mate/tmp/bilibili-shots/samples/0600.png)
- [`0680.png`](/C:/project/my-mate/tmp/bilibili-shots/samples/0680.png)

## High-Level Product Shape

From the sampled frames, the reference product does not behave like a form-driven workflow launcher.

It behaves like a task workspace with three simultaneous surfaces:

1. **Task / project context panel**
2. **Central working canvas**
3. **Right-side conversational event stream**

This is the main structural difference from the current My Mate mobile MVP.

## Interaction Flow Reconstructed

### Stage 1: direct task entry

At the beginning of the video, the interface is already centered on a task request.

Signals from early frames:

- no heavy setup wizard
- no explicit template picker in the main flow
- the task exists as the primary object on screen
- there is a conversational input area at the bottom

What this creates:

- immediate delegation feeling
- low ceremony
- the sense that the user is talking to a system, not configuring a system

### Stage 2: orchestrator understanding and summarization

Around the first 1-2 minutes, the UI starts showing structured understanding output.

Signals:

- a summary card or interpretation block appears in the center-left
- the right column accumulates message-like entries
- the product presents intermediate understanding, not only final outputs

What this creates:

- the user sees that the agent is interpreting the task
- progress is narrative, not just status-based

### Stage 3: task decomposition into concrete work packages

Around the middle section, the UI shows a more explicit work structure.

Signals:

- cards representing sub-tasks or work modules
- naming that looks closer to mission/task units than to raw DAG node ids
- multiple columns of information at once

This is a critical product move:

- the system exposes decomposition
- but it does not force the user into low-level graph editing

That balance is important. It feels agentic without feeling overly technical.

### Stage 4: external tool or content workspace integration

One sampled frame shows a different workspace entirely, likely an external content or asset environment.

Signals:

- the user is no longer only in a single “status page”
- the workflow appears to bridge into other tools or output systems
- the agent workflow is part of doing work, not only part of planning work

This matters because it changes the product from:

- “workflow management”

to:

- “work execution environment”

### Stage 5: result assembly and deliverable preview

Later frames show a more mature multi-card layout with task output and concrete deliverable material.

Signals:

- content cards become richer
- central area holds structured output blocks
- right-side event stream continues to show step-by-step progress
- one frame shows what appears to be a final mobile-style deliverable preview

This is where the demo earns trust:

- the user sees not only “completed”
- the user sees the thing that was made

## Why The Demo Feels Agentic

### 1. The task is the anchor, not the template

The UI is centered on “what I want done”.

The current My Mate MVP is centered on:

- template
- schema
- run

That makes the current experience feel procedural.

### 2. The conversation is continuous

The right-side stream gives a sense that the system is:

- receiving
- interpreting
- deciding
- reporting

This is stronger than a separate inbox or status page.

### 3. Intermediate reasoning is productized

The demo does not hide the middle.

It surfaces:

- summaries
- sub-tasks
- execution progress
- output assembly

That middle layer is exactly what your current app is missing.

### 4. The system appears to move between planning and doing

The sampled frames suggest the experience is not split into:

- one page for planning
- one page for execution

Instead, execution feels like a continuation of the same task thread.

### 5. Deliverables are visible, not abstract

The user sees the actual content artifact trajectory.

That creates a much stronger sense of progress than:

- `run.status = running`
- `artifact_count = 3`

## Product Lessons For My Mate

### Replace run-first with task-first

The product object exposed to users should be:

- `Task Session`

not:

- `Run`

`Run` should remain an internal execution object.

### Merge planning and follow-up into one thread

The current split across:

- create page
- inbox
- run detail

should become one thread where the user can see:

- request
- clarifying questions
- plan proposal
- execution updates
- approvals
- outputs

### Show work packages, not only telemetry

The user should see:

- what the orchestrator is trying to do
- what subtask is active
- what changed in the plan

not only:

- timeline event labels
- node status badges
- raw counts

### Keep the graph behind an intelligible layer

The reference does not appear to force raw DAG vocabulary too early.

That suggests a good product hierarchy:

1. plain-language task thread
2. subtask cards
3. optional DAG / node view

### Make outputs part of the thread

Artifacts should not be buried in a separate section.

They should appear inline as:

- draft result cards
- comparison cards
- final handoff cards

## Concrete Gap Against Current My Mate

Current My Mate mobile:

- intent form
- template selection
- schema form
- candidate plan preview
- run detail telemetry

Reference demo:

- direct task framing
- conversation-first progression
- visible decomposition
- continuous execution narrative
- concrete deliverable surface

So the missing layer is not merely:

- better template recommendation

The missing layer is:

- a conversational orchestrator workspace

## Recommended Immediate Product Response

1. Introduce `Session` as the primary user object
2. Replace `Create Run` with `New Task`
3. Render planner output as conversation cards
4. Render run progress as subtask cards in-thread
5. Keep DAG as a secondary expandable surface
6. Move artifacts into the main conversation timeline

## Limits Of This Review

This review is based on:

- page screenshot
- public metadata
- storyboard samples

It is not a full transcript-based review of every spoken moment.

If a more exact reconstruction is needed later, the next step should be:

- extract audio
- obtain transcript
- align transcript to sampled frames

That would support a more detailed conversation-state machine reconstruction.
