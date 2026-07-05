# My Mate Conversation-First Orchestrator Redesign

This document captures the first major correction away from the old run-first
shell.

The newer dual-video alignment in
[`docs/13-dual-video-product-alignment.md`](/C:/project/my-mate/docs/13-dual-video-product-alignment.md)
refines the target further:

- `Mission` is the top-level product object
- `Session` remains important, but as the conversation rail inside that Mission

This document explains why the current app feels weak in practice, what target experience it should move toward, and how to evolve the existing architecture into a conversation-first orchestrator product.

## Problem Statement

The current app is functional, but it still behaves like a workflow launcher:

- user enters intent in a form
- planner selects a template
- candidate plan is previewed
- run is created
- user later checks a run status page

This is useful as an MVP for validation and control-plane wiring, but it does not yet feel like:

- talking to an agent
- delegating a real-world task
- watching the system reason and adapt
- intervening naturally while the task is in progress

That gap is the core reason the product currently feels "鸡肋".

## What The User Actually Wants

The desired experience is closer to a conversation-driven task operating system:

1. The user starts with natural language, with text as the primary interaction mode.
2. An orchestrator agent understands the task and asks follow-up questions only when needed.
3. The orchestrator proposes a plan in plain language.
4. The orchestrator turns that plan into a runnable DAG.
5. During execution, the orchestrator can:
   - add nodes
   - skip branches
   - increase or reduce fanout
   - request human confirmation
   - summarize progress continuously
6. The user sees both:
   - the conversation thread
   - the evolving execution graph
7. The user can intervene in natural language instead of only pressing control buttons.

This is not a template picker with status polling. It is a conversational control loop around planning, execution, and intervention.

## Reference Experience Signals

The reference video you shared is:

- title: `【Demo】用Niuma语音Agent做一个小红书图，准备参加B站AI创造公开赛，Build In Public`
- source: Bilibili video `BV1p67D6fE6n`
- description highlights:
  - direct natural-language task interaction
  - a real task completed while traveling
  - a concrete artifact outcome
  - a feeling that the agent is doing work, not just collecting fields

From the available metadata, the important product signals are:

- the task starts as a natural text request, not as schema entry
- the system is proactive
- the system feels agentic because work unfolds during the interaction
- the user tracks progress through a narrative, not only through status labels
- the final value is a concrete result artifact

## Current Product Shape

The current repository is still centered on three primitives:

1. `template selection`
2. `candidate plan preview`
3. `run follow-up status`

This shows up clearly in the current implementation:

- mobile create flow is intent form + template selection + schema form + create
- planner is still `rule_based_v1`
- `generateCandidatePlan()` plans only under an existing published template
- `generateDagDraft()` exists, but it is still a deterministic draft builder, not a true orchestrator planner
- run follow-up shows timeline, artifacts, pending approvals, and pause/resume/cancel controls
- there is no persistent conversation thread binding user intent, planner reasoning, runtime changes, and node-level explanations together

## Why It Feels Weak

### 1. The system starts from forms, not from dialogue

The create flow still asks the user to:

- choose or accept a template
- fill schema inputs
- preview
- submit

That is a configuration flow. It is not a delegation flow.

### 2. The planner is not an orchestrator yet

The current planner:

- ranks templates
- derives a candidate plan from template constraints
- validates registry bindings

It does not:

- break the task into subgoals dynamically
- synthesize a fresh execution graph from intent
- revise the graph during runtime
- narrate its planning choices to the user

### 3. Runtime is observable, but not conversational

The run detail page exposes:

- active task
- timeline
- artifacts
- approvals and input requests
- pause / resume / cancel

This is decent control-plane telemetry, but it still reads like an operations console. The user does not feel they are in an ongoing collaboration with an orchestrator.

### 4. User intervention is mechanical, not semantic

Current intervention is mainly:

- approve
- reject
- submit input
- pause
- resume
- cancel

What is missing is natural intervention such as:

- "这个方向不对，换成面向产品经理语气"
- "先不要出图，先给我看文案提纲"
- "再加一个竞品对比节点"
- "这一步不要并行，改成我先确认再继续"

### 5. The graph is hidden from the main product loop

Even if the backend has DAG concepts, the user-facing interaction is not organized around:

- plan
- nodes
- dependencies
- branch changes
- execution rationale

So the orchestrator’s intelligence is not legible.

## Product Direction

The app should move to a dual-surface interaction model:

1. **Conversation surface**
   - the primary interface
   - where task intent, follow-up questions, approvals, summaries, and interventions happen
2. **Execution surface**
   - a secondary but always available view
   - where DAG, node state, branch changes, and artifacts are visible

The conversation is the product.
The DAG is the engine and the evidence.

## Target Interaction Model

### Phase 1: task intake

The user says:

> 帮我做一个小红书图，主题是这个新闻，面向想去自驾旅行的人，风格不要太硬广。

The orchestrator responds with:

- task understanding
- missing information questions
- a first-pass approach

Example:

- I can first extract the news angle, then draft the post copy, then generate visual concepts, then produce a final card.
- I still need:
  - the target platform tone
  - whether you want one card or a carousel
  - whether I can use web references

### Phase 2: plan proposal

Before execution, the orchestrator shows:

- concise natural language plan
- optional expandable DAG view
- risk and approval points

Example:

1. Understand the source material
2. Draft content angle
3. Create 2 visual directions
4. Ask for your selection
5. Generate final deliverable

### Phase 3: dynamic execution

During execution, the orchestrator can emit updates like:

- "I found the source news, but the details are thin. I am cross-checking one more source."
- "The first visual direction is too generic. I am adding a competitor reference step."
- "I split the writing into title and body because the first draft was too dense."

This is where dynamic DAG mutation should happen under the hood.

### Phase 4: natural intervention

The user should be able to say:

- "换一个更像真实博主的语气"
- "不要继续做图，先给我文案"
- "保留方向 B，再加一个更克制的版本"

The orchestrator then:

- interprets the request
- maps it to DAG change operations
- updates the plan
- explains what changed

### Phase 5: result handoff

The final experience should end with:

- artifact output
- concise execution summary
- editable next actions

Example:

- final Xiaohongshu image
- caption draft
- notes on which branch was chosen
- suggested follow-up variants

## Architectural Changes Needed

### A. Introduce a real Orchestrator Session

Add a first-class object above `Run`:

- `ConversationSession` or `OrchestratorSession`

It should bind together:

- user messages
- orchestrator messages
- planning decisions
- linked run ids
- DAG revisions
- approvals and human input events

Without this, the app will continue to feel like disconnected pages.

### B. Add conversation-native APIs

The current API surface is run-centric.

Add:

- `POST /api/sessions`
- `POST /api/sessions/:sessionId/messages`
- `GET /api/sessions/:sessionId`
- `GET /api/sessions/:sessionId/stream`
- `POST /api/sessions/:sessionId/interventions`

These endpoints should support:

- user message submission
- orchestrator response streaming
- plan proposals
- DAG update events
- approval prompts
- final result summaries

### C. Add an Orchestrator Planner layer

Today:

- planner selects templates
- planner drafts from templates or registry heuristics

Needed next:

- an orchestrator planner that converts goals into task graphs
- a planner that can choose between:
  - reuse template
  - derive template variant
  - synthesize fresh DAG
- runtime replanning based on intermediate outputs

This layer should own:

- task decomposition
- agent assignment
- skill selection
- branch policy
- approval placement
- fallback strategy

### D. Add runtime DAG mutation primitives

The control plane needs explicit operations such as:

- `add_node`
- `remove_node`
- `skip_node`
- `insert_branch`
- `change_parallelism`
- `replace_agent_binding`
- `pause_for_replan`
- `resume_with_patch`

These are the bridge between natural-language intervention and execution behavior.

### E. Make graph changes visible as events

Add event types such as:

- `plan.proposed`
- `plan.confirmed`
- `plan.revised`
- `node.inserted`
- `node.skipped`
- `branch.added`
- `parallelism.changed`
- `orchestrator.message`
- `user.message`

Without these, the runtime remains opaque.

## Mobile UX Changes Needed

### Replace "Create Run" with "New Task"

The first screen should not look like a form.

It should look like:

- a conversation composer
- optional attachment entry
- recent goals / suggested task types

### Make the task thread the primary screen

The task thread should include:

- user messages
- orchestrator thinking summaries
- plan cards
- approval cards
- artifact cards
- node progress cards
- intervention chips

This should replace the current split between:

- create page
- inbox page
- run detail page

Those can still exist, but they should become secondary views.

### Add a collapsible execution graph panel

Within the task thread, the user should be able to open:

- current graph
- node statuses
- changed nodes
- waiting nodes
- outputs by node

This keeps the orchestrator legible without forcing every user into Studio.

### Keep input text-first

The primary product path should be text-first.

Reasons:

- mobile input methods already provide usable speech-to-text
- the real product gap is orchestration and dynamic work visibility
- text-first keeps the implementation scope tighter in the next phases

Voice can remain an optional extension later, but it should not drive the main roadmap.

## Backend Evolution Path

### Stage 1: conversation wrapper around existing planner and runs

Do this first.

Keep existing run creation, but introduce:

- session record
- message timeline
- orchestrator summary messages
- a session thread in mobile

At this stage, the orchestrator can still call:

- template selection
- candidate plan
- create run

But the user experience becomes conversational.

### Stage 2: DAG draft as a first-class conversational artifact

Instead of showing only a candidate preview, show:

- plain language plan
- editable DAG draft
- human confirmation

Use `POST /api/planner/dag-draft` as the bridge, but expose it through a conversational session.

### Stage 3: runtime replan and DAG patching

Add:

- DAG patch operations
- orchestrator decision logs
- runtime branch changes
- user intervention translation

This is the step where the product starts to feel truly agentic.

### Stage 4: autonomous orchestrator policy

Only after the conversation loop and DAG patching are in place should you invest heavily in:

- LLM-based planner
- cost-aware routing
- agent policy tuning
- richer registry recommendation

Otherwise you risk making the planner smarter inside a product shell that still feels static.

## Recommended Build Order

### P1: conversation-first shell

- add `Session` model
- add message timeline APIs
- add mobile task thread screen
- convert create flow into task conversation start
- render planner output as chat cards

### P2: DAG draft in the conversation loop

- expose draft DAG in thread
- require human confirmation before execution
- attach registry and validation issues to plan cards
- allow simple user edits such as:
  - change objective
  - change tone
  - add one more research step

### P3: runtime intervention and graph mutation

- support natural-language intervention
- map intervention to DAG patch operations
- show graph diff after each change
- support pause -> patch -> resume

### P4: richer execution presence

- streaming orchestrator updates
- richer artifact cards
- proactive notifications

## What Not To Do Next

Avoid spending the next cycle mainly on:

- polishing the current create form
- adding more fields to template selection
- improving static dashboard density
- building Studio canvas first while mobile remains non-conversational

Those can all be useful later, but they will not solve the main product weakness.

## Practical Conclusion

The current system proves:

- control-plane wiring
- planner validation
- mobile shell viability
- run intervention basics

But it does not yet prove the real product thesis.

The real thesis is:

- a user can talk to an orchestrator
- the orchestrator can design and execute work dynamically
- the user can see and steer that work naturally

That should become the next product center of gravity.

## Suggested Immediate Next Doc

After this redesign note, the next useful artifact should be a concrete execution plan for:

- session data model
- conversation APIs
- mobile task thread UI
- orchestrator event model
- DAG patch protocol

That should be the bridge from product direction to implementation work.
