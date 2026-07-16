# Conversation File Target Resolution

## Goal

Make file modification turns deterministic without moving natural-language intent parsing into Studio. The client supplies explicit user context, the conversation model resolves genuine ambiguity, and the Control Plane remains authoritative for artifact identity, versions, permissions, and persistence.

## Responsibility Split

### Studio and Desktop

- Let the user select a generated Workboard artifact as the current file target.
- Send the stable `target_artifact_id` with the conversation turn.
- Keep the selected target scoped to the active Session.
- Show Preview, Download, version history, and Diff using server-backed artifact routes.

The client does not infer phrases such as "the Chinese file" with regexes.

### Conversation Model

- Classify file-related wording outside the deterministic action lexicon as `modify`, `translate`, or `none`.
- Interpret the latest instruction when the user did not explicitly select a target.
- Select from a bounded candidate list supplied by the Control Plane.
- Return a structured source attachment id, confidence, and reason.
- Use confidence below `0.70` when the instruction does not identify one candidate reliably.

The model never invents a path, artifact id, version, or download URL.

### Control Plane

- Validate that an explicit target belongs to the active Session and has readable content.
- Resolve same-name artifacts to their latest version only when no explicit version was selected.
- Apply target precedence consistently across WebSocket and HTTP conversation turns.
- Inject only the selected source attachment into the file-generation model call.
- Persist source selection evidence on the generated artifact.
- Stop in `waiting_human` when the target is missing, invalid, or ambiguous.

## Resolution Precedence

1. Explicit `target_artifact_id` selected in Workboard.
2. Exact file name present in the instruction.
3. A unique language match for modification requests.
4. A single readable candidate.
5. A single server-generated artifact among input references.
6. Structured model selection from the remaining bounded candidates.
7. Human clarification when confidence is below `0.70` or the returned id is invalid.

Before target resolution, common file operations use a deterministic fast path. File-related wording outside that lexicon is sent through a bounded model classification contract. The classifier receives candidate metadata but no file contents and cannot create an artifact or download URL.

An explicit target always overrides model inference and language matching.

## Turn Contract

```json
{
  "type": "conversation.send",
  "request_id": "conversation-request-id",
  "content": "Add a table of contents",
  "target_artifact_id": "att_...",
  "provider_connection_id": "connection-id",
  "model": "model-id"
}
```

The persisted generated artifact records:

```json
{
  "source_attachment_id": "att_...",
  "source_selection_source": "explicit",
  "source_selection_confidence": 1,
  "source_selection_reason": "The user explicitly selected this Workboard artifact."
}
```

## Autonomy and Approval

This resolver identifies the source artifact; it does not grant filesystem write authority.

- Creating a Session artifact remains an isolated, server-persisted output operation.
- Writing changes back to a Desktop workspace must still pass workspace binding, Local or Docker worker routing, change-set generation, and the configured Review First, Assisted, or Autopilot policy.
- Preview and Diff are evidence surfaces and do not imply that a workspace change has been applied.

## Failure Behavior

- Missing source: ask the user to attach or select a file.
- Stale explicit id: ask the user to reselect from Workboard.
- Multiple candidates and low confidence: list candidate names and do not generate a file.
- Provider failure during selection: fall back to clarification, not the most recent file.
- Provider claims an unpersisted artifact: reject the claim and omit the download link.
