# M13-M17: Skill Platform

## Outcome

M13-M17 completes the first governed Skill Platform on top of the M12 package
contract. Skills can now be selected automatically or explicitly, frozen into
a Workspace lockfile, installed and upgraded through quarantine checks, and
evaluated against their declared output contract. Studio exposes the same
policy, package, installation, and invocation state as the Control Plane.

## M13: Activation and Workspace policy

- The Conversation Agent receives the enabled Skill catalog and can activate a
  Skill explicitly with `skill_load`.
- Deterministic intent scoring can auto-activate an eligible Core Skill when
  the Workspace policy allows it. Longer, more specific keywords outrank
  generic matches.
- A loaded Skill narrows later Provider rounds to its declared tools plus the
  Skill control tools.
- Workspace profiles persist auto-activation, enabled categories, trusted
  sources, update policy, and version pins.
- A deterministic lockfile records the exact enabled package versions and
  instruction digests used by the Workspace.

## M14: Core Skill catalog

The bundled catalog contains 15 packages:

- Artifact workflows: `artifact-code`, `artifact-document`, `artifact-pdf`,
  `artifact-presentation`, `artifact-spreadsheet`, and `artifact-transform`.
- Research workflows: `web-research` and `arxiv-research`.
- Coding workflows: `repository-inspection`, `coding-plan`, `code-review`,
  `systematic-debugging`, and `test-driven-development`.
- Host and integration workflows: `desktop-diagnostics` and `github-workflow`.

These packages provide bounded instructions, activation metadata, declared
tools, permission scopes, input schemas, and output contracts. They do not
grant capabilities by themselves.

## M15: Executable Skill boundary

Most Skills remain instruction-only. A Skill may declare a bounded script, but
the script never executes inside the Control Plane process.

The current execution chain is:

1. The active Skill exposes `skill_script_run` only when its manifest declares
   the requested script.
2. The Capability Registry validates the action and risk policy.
3. Desktop supplies a one-time approval attestation for the dangerous write.
4. The Control Plane dispatches the approved request to the Docker Worker
   runner.
5. The Worker mounts only the declared Skill package, input, and target
   Workspace, applies resource limits, and returns bounded evidence.

Denial preserves `worker_action_denied` and does not launch Docker. Missing
Docker returns a bounded capability error instead of falling back to host
execution.

## M16: Marketplace and upgrades

- Quarantine scanning rejects traversal, symlinks, sensitive package paths,
  excessive size, destructive shell patterns, credential reads, and
  download-and-execute patterns.
- Optional Ed25519 verification binds a package digest to a configured source
  public key. Tampering invalidates the signature.
- Catalog source paths must remain inside the configured local source root.
- Installation provenance is persisted in `my-mate.installation.json` and is
  retained by rollback.
- Previous versions remain available for explicit rollback.
- An upgrade that adds tools, capabilities, permission scopes, or scripts
  returns `skill_permission_delta_review_required`. Installation continues
  only when the caller sends `approve_permission_delta: true`.

## M17: Verification and observability

- Every activation records Skill ID, version, activation source, instruction
  digest, Session, action lineage, and verification status.
- Provider failure marks the associated invocation and evaluation failed.
- Persisting an output artifact verifies the associated invocation as passed.
- Evaluation records upsert by invocation ID so pending and final states do
  not become duplicate observations.
- Workspace observability reports package health, invocation/evaluation
  counts, pass rate, failures, and actionable recommendations without storing
  private prompt or artifact content in telemetry metadata.

## Product surface

Studio exposes the platform under `Advanced > Registry > Skills`:

- package count, readiness, enable/disable, exact instruction preview;
- Workspace auto-activation policy and lockfile count;
- local package path, quarantine scan result, permission delta, install and
  explicit upgrade approval;
- recent invocation source, state, and output verification.

The Control Plane, Gateway allowlist, OpenAPI schema, and generated shared types
cover the same lifecycle and observability APIs.

## Artifact execution boundary

The presence of `artifact-document`, `artifact-pdf`, or
`artifact-presentation` still does not grant file-system or execution access by
itself. Binary PDF, DOCX, PPTX, and XLSX work is now handled by the separate,
pinned Artifact Worker described in `docs/65-artifact-worker.md`. Media and
archive adapters remain separate future capabilities and are not implied by
the Office/PDF adapter.

Skill packages also cannot bypass Capability Registry schemas, Desktop
approval, Docker isolation, Workspace boundaries, or audit policy.

## Acceptance

Focused tests cover activation, specificity, lockfiles, Hermes compatibility,
declared script enforcement, approval denial, Docker unavailability, version
retention, rollback, signatures, permission-delta approval, invocation
evaluation, Provider failure, and spreadsheet artifact verification.

Browser acceptance covers policy persistence, package scanning, first install,
permission-expanded upgrade approval, narrow-screen containment, and clean
console output.
