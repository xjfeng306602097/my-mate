# Visual Acceptance Guide

This guide defines the current visual acceptance flow for the My Mate MVP.

## Local URLs

- Studio: `http://127.0.0.1:5174`
- API Gateway: `http://127.0.0.1:4030/health`
- Control Plane: `http://127.0.0.1:4010/health`

## Seeded Acceptance Data

Template:

- `acceptance-phone-collab-demo`
- Published
- Four nodes:
  - `node_research`
  - `node_write`
  - `node_phone_review`
  - `node_end`

Agent profiles:

- `acceptance-research-agent`
- `acceptance-writer-agent`
- `acceptance-review-agent`

Skills:

- `acceptance-research`
- `acceptance-writing`
- `acceptance-review`

## Acceptance Flow

1. Open Studio at `http://127.0.0.1:5174`.
2. Select `Acceptance Phone Collaboration Demo` in the left template list.
3. Confirm the template badge is `published v1`.
4. Confirm `Registry Manager` shows the acceptance agent profiles and skills.
5. In `Intent Planner`, enter:

   ```text
   Use phone to coordinate competitor research and produce a summary for product team
   ```

6. In `Inputs JSON`, enter:

   ```json
   {
     "goal": "Research phone collaboration agent product",
     "audience": "product team",
     "priority": "high"
   }
   ```

7. Click `Plan from intent`.
8. Confirm the selected candidate is `acceptance-phone-collab-demo`.
9. Confirm the plan preview is `valid`.
10. Confirm the preview nodes show:
    - OpenClaw agent binding
    - skills
    - registry provenance source
11. Click `Copy preview as draft` or `Save preview as draft` to validate the Studio draft workflow.

## Optional Mobile Flow

Use the mobile app against:

```text
EXPO_PUBLIC_MY_MATE_API_BASE_URL=http://127.0.0.1:4030
```

Then create a task using the same intent and inputs. The candidate plan should surface the same node count and registry-derived binding information.

## Current Scope

This acceptance flow validates:

- visual Studio access
- template selection
- registry management visibility
- registry-backed planner candidate preview
- strict-by-default mobile run creation, including explicit warn override after confirmation
- editable DAG copy/save path

It does not yet validate:

- production auth
- push notifications
- dynamic DAG mutation during a running Run
