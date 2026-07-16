# Product Intelligence Autonomy, Repair, And Quality Closure

Status: complete
Scope: `PX-06`, `PX-07`, `PX-08`
Verified: 2026-07-13

## Objective

Let a user control My Mate through understandable policy, receive one concrete
repair recommendation when work cannot advance, and judge whether a returned
result is trustworthy without interpreting runtime internals.

## Autonomy Policy

The normal product exposes three policies:

| Mode | Behavior |
|---|---|
| Review first | Show the recommended plan before execution. |
| Assisted | Proceed with routine work and stop for risk, cost, permission, ambiguity, or quality concerns. |
| Autopilot | Proceed automatically inside explicit boundaries. |

The selected mode is persisted in workspace `default-agent` metadata as
`product_autonomy_mode`. Studio also stores the immediate preference locally so
the policy remains usable before model setup or while a governed Registry
change awaits review.

Autopilot is intentionally bounded:

```text
new task prepared
  -> autonomy is Autopilot
  -> verified model exists
  -> Task Guidance says routine-ready
  -> one guarded automatic advance attempt
  -> existing Session message contract
  -> strict validation and human gates remain authoritative
```

## Repair Guidance

`task-intelligence-model.js` maps existing truth to a product repair action:

| Condition | Recommendation |
|---|---|
| Model or credential unavailable | Verify model in Settings |
| No published workflow | Add or choose a workflow in Library |
| Route is stale | Update plan |
| Strict validation failed | Review plan |
| Run stopped | Scan existing Recovery state |
| Other transition failure | Review preserved conversation evidence |

Prerequisites are ordered. For example, an unverified model is repaired before
a downstream workflow or execution attempt.

## Result Trust

The result-quality projection uses persisted Scorecard and Evaluation records.
Labels are intentionally conservative:

- `Not checked`: neither check family exists
- `Checking`: independent evaluation is queued or running
- `Partially checked`: available checks did not fail, but one check family is
  missing or incomplete
- `Review needed`: any contract, pipeline, evidence, quality, gate, or finding
  fails
- `Trusted`: pipeline and contract Scorecard checks pass and independent
  quality and evidence Evaluation checks pass

`Check quality` calls the existing Scorecard and deterministic Evaluation APIs.
It does not synthesize a verdict in the browser.

## Verification

- Studio syntax, interaction smoke, DAG layout checks, and `git diff --check`
  pass.
- Seven focused task-intelligence tests cover policy normalization, model and
  workflow repair, stopped-Run recovery, unchecked evidence, trust criteria,
  and failed-check visibility.
- Three Task Guidance composition tests cover Review first, Check quality, and
  repair priority.
- Browser validation confirms `Review first -> Assisted` persists through the
  Gateway to workspace `default-agent` metadata; the final policy is Assisted.
- Browser validation confirms an unverified model produces one `Verify model`
  action that opens simplified Settings.
- A 390 x 844 viewport shows all three autonomy choices without page-level
  horizontal overflow and the browser console remains error-free.
