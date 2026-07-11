# OBS-02 Agent Cost Attribution And Operational Reporting

## Purpose

OBS-02 turns provider usage evidence into an operational cost report that can
answer which Agent Profile, provider/model, and work package consumed model
budget, and how complete that accounting evidence is.

The feature builds on Evidence Protocol V2, provider adapters, catalog pricing,
and the indexed OBS-01 Dashboard path. It does not scan raw Evidence on every
Dashboard request.

## Cost Semantics

The effective-cost rule is fixed and explicit:

1. Use `provider_reported_cost` when the provider supplied it.
2. Otherwise use `estimated_cost` when the pricing catalog produced one.
3. Otherwise keep the Job cost unavailable.

Provider and estimated totals remain separately visible. When the same usage
record contains both values, effective total includes only the provider value,
preventing double counting.

Money is aggregated as decimal strings per currency. OBS-02 does not perform
foreign-exchange conversion and never adds different currencies together.

## Observability Index V2

The derived per-Run index moves from schema V1 to V2. Existing V1 indexes fail
the version check and rebuild lazily through the existing dirty/index path.
Canonical Runs, Plans, Jobs, Evidence, Scorecards, and Evaluations are not
modified.

Each indexed Job now includes Node, Agent Profile, work package, runtime,
status, attempt, and duration identity. Each indexed usage point includes Agent
Profile, work package, provider/model, tokens, provider cost, and estimated
cost. Agent/work-package identity comes from the frozen compiled Run Plan, with
the dispatch envelope used as an Agent compatibility fallback.

## Report Contract

`GET /api/dashboard/summary` now returns
`observability.cost_report` within the selected window and status filter.

```json
{
  "basis": "provider_reported_preferred",
  "coverage": {
    "runs_observed": 3,
    "model_jobs": 3,
    "costed_jobs": 2,
    "provider_reported_jobs": 1,
    "estimated_only_jobs": 1,
    "unavailable_jobs": 1,
    "cost_completeness": "partial"
  },
  "totals": {
    "effective_costs": { "USD": "0.2" },
    "provider_reported_costs": { "USD": "0.12" },
    "estimated_costs": { "USD": "0.18" }
  },
  "by_agent": [],
  "by_provider_model": [],
  "by_work_package": []
}
```

Every attribution group contains Run count, model/usage/costed/unavailable Job
counts, failed Jobs, retry attempts, total tokens, completeness, cost source,
and the three cost maps.

Completeness is:

- `complete`: every model Job in the group has provider or estimated cost
- `partial`: at least one but not every model Job has cost
- `unavailable`: no model Job has usable cost, or the group has no model Jobs

Provider/model groups retain an explicit `unknown/unknown` group for model Jobs
without usage evidence. Unassigned Agents and nodes without a work package are
also kept visible instead of being dropped.

## API And SDK

The additive Dashboard contract is defined in OpenAPI with
`DashboardMoneyTotals`, `DashboardCostAttributionGroup`, and
`DashboardCostReport`. Generated TypeScript exports include the Dashboard
summary and cost report types. API Gateway regression coverage proves the
report passes through unchanged.

The query continues to support `window_hours=1..720`, all existing status
filters, retention, comparison, and index-pruning semantics.

## CLI

```bash
my-mate cost-report
my-mate cost-report --window-hours 168 --status completed
my-mate cost-report --group-by model
my-mate cost-report --group-by work-package --limit 10
my-mate cost-report --json
```

The default view is the last 24 hours grouped by Agent. Human output always
prints completeness, effective total, per-group source, failures, and retries.

## Studio

The Dashboard Cost Attribution panel contains effective total, global
completeness, provider/estimated/unavailable Job counts, and Agent, Model, and
Work Package segmented views. Per-group rows expose Job coverage, tokens,
effective cost, source, failures, retries, and Run count.

The table fits without internal scrolling at the wide desktop acceptance
viewport. At narrow widths it scrolls inside the report panel while the page
itself remains free of horizontal overflow.

## Validation

Automated and browser acceptance covers:

- Observability Index V2 rebuild and query version
- Agent attribution across model Jobs
- provider-reported preference over simultaneous estimate
- estimated fallback when provider cost is absent
- explicit unavailable model Jobs and partial completeness
- Gateway pass-through and CLI rendering
- Studio Agent/Model/Work Package switching
- `1440 x 900` and `390 x 844` layout behavior
- clean browser console

Repository verification:

```bash
npm run check
npm test
npm run build:runtime
git diff --check
```

## Boundaries

- Provider-reported cost is evidence, not an invoice reconciliation feed.
- Catalog estimate remains an estimate and is labeled separately.
- No currency conversion, tax, credit, subscription, or billing-account
  reconciliation is attempted.
- Model evaluator usage stored on Evaluation records is not charged back to the
  source Run in this phase.
- Budget enforcement and alerts remain policy work; OBS-02 is accounting and
  reporting only.
