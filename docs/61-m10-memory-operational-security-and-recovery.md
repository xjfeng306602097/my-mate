# M10: Memory Operational Security and Recovery

Status: completed (2026-07-17)

M10 closes the operational lifecycle around Private Memory. It adds Workspace data-key rotation, physical purge with derived-copy removal, passphrase-encrypted logical backup and recovery, explicit retention execution, and integrity scanning.

## Delivered

### Envelope encryption and key lifecycle

- The configured or local root secret wraps a random Workspace data key; it no longer directly encrypts new Private Memory payloads.
- Encrypted payloads carry an opaque `key_id`. M8/M9 schema-1 payloads remain readable and migrate during rotation.
- Rotation creates a new data key, re-encrypts canonical Memory, candidates, snapshots, turn contexts, overlays, and onboarding drafts, then destroys retired Workspace keys.
- Public status exposes key identifiers and timestamps only. Key material never enters API responses, audit metadata, logs, or metrics.

### Hard purge and cryptographic erasure

- Hard purge requires `memory.manage` and an exact `confirm_memory_id` match.
- It removes the canonical record plus content-bearing candidates, Core Memory snapshots, turn contexts, overlays, feedback, and onboarding references.
- Retrieval indexes are rebuilt and optional knowledge graph provenance is invalidated/rebuilt.
- Purging Private Memory rotates all remaining encrypted records before retired keys are destroyed, making stale copies encrypted under the old Workspace key unreadable.
- Content-free audit and operation evidence remains available.

### Backup and recovery

- Backups contain logical Memory records, not raw keyring files.
- The complete bundle is encrypted with AES-256-GCM using a passphrase-derived scrypt key.
- Restore validates Workspace identity, authentication tag, and a SHA-256 manifest digest before writing anything.
- Dry-run verification proves the passphrase and manifest without changing Memory.
- Restored Private Memory is encrypted under the current Workspace data key, so backups survive key rotation and cryptographic erasure.

### Retention and integrity

- Workspace settings now define retention for soft-deleted Memory, expired Memory, turn contexts, feedback, and encrypted backups.
- Retention runs only through an explicit managed operation; malformed evidence is retained for integrity review instead of silently deleted.
- Integrity scans decrypt and validate records, enforce Workspace boundaries, and report orphan references without persisting Memory content.

## API

```text
GET  /api/memory-operations
POST /api/memory-keys/rotate
POST /api/memory-integrity/scan
POST /api/memory-retention/run
GET  /api/memory-backups
POST /api/memory-backups
POST /api/memory-backups/:backupId/restore
POST /api/memories/:memoryId/purge
```

Gateway allowlisting, OpenAPI, generated types, permission routing, Studio controls, and responsive layout are included.

## Acceptance Evidence

- M10 focused tests: 5 passed, covering full Private surface re-encryption, hard purge, key destruction, backup recovery, retention, integrity, and APIs.
- Control Plane regression: 329 passed, one optional live test skipped, zero failures.
- Gateway regression: 36 passed, including the complete M10 route surface.
- Shared types, Control Plane, Gateway, and Studio checks pass.
- Browser acceptance passes on desktop and 375 x 844 with no page-level horizontal overflow. Integrity scan completes from Studio and the browser viewport override is reset.

## Non-Goals

- Cloud KMS/HSM integration and centralized enterprise key escrow.
- Cross-Workspace or Organization Memory sharing, which belongs to M11.
- External knowledge synchronization conflict policy, which belongs to M11.
