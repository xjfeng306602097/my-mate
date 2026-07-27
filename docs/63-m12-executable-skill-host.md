# M12: Executable Skill Host

## Outcome

M12 turns Skills into versioned, progressively loaded workflow packages. A package contains `my-mate.skill.json`, `SKILL.md`, and only the resources declared by its manifest. Package code is never executed.

The model initially receives a concise enabled catalog. It can call `skill_search` to discover candidates, `skill_load` to load one exact instruction document, and `skill_resource_read` to read a declared resource. After a successful load, later Provider rounds expose only the Skill's `allowed_tools` plus the three Skill control tools.

## Execution boundary

- Side effects still execute through the Capability Registry, MCP Host, trusted Desktop bridge, or Runtime Worker.
- Existing risk tiers, approval rules, and Docker isolation remain authoritative.
- Skill packages cannot bypass tool schemas, permission scopes, Workspace boundaries, or action evidence.
- Installation rejects traversal, symbolic links, sensitive paths, oversized files, and undeclared resources.
- Invocation records persist package version, instruction digest, action lineage, status, and completion time. They do not persist secrets or private content.

## Package contract

Required files:

- `my-mate.skill.json`: semantic version, description, risk level, allowed tools, required capabilities, scopes, resources, input schema, and output contract.
- `SKILL.md`: bounded workflow instructions loaded exactly on demand.

Discovery sources are bundled repository packages, Workspace-installed packages, and explicitly configured custom roots. Workspace-installed packages override a bundled package with the same ID for that Workspace.

## Management

The Control Plane exposes package list/detail, reload, local install, enable/disable, and invocation-history APIs under `/api/skill-host`. Studio's Skills view provides the same lifecycle controls, exact instruction preview, compatibility status, declared tool visibility, and recent invocation history.

The first acceptance package is `web-research` v1.0.0. It requires `web_search` and `web_fetch`, optionally uses isolated browser capabilities, and explicitly treats external page content as untrusted.

## Verification

Focused tests cover bundled discovery, compatibility, deterministic search, exact instruction loading, tool filtering, invocation completion, sensitive-resource rejection, and package-management HTTP APIs. Full repository checks and regression tests remain the release gate.
