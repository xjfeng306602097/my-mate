# Runtime Worker Release Engineering

Status: REL-01, REL-02, and REL-03 implementation baseline.

Last updated: 2026-07-12.

## Release Identity

The Runtime Worker release version is read from
`services/runtime-worker/package.json` and must match the repository package
version. The default local image is:

```text
my-mate-runtime-worker:<semantic-version>
```

Production deployments must use a registry digest:

```text
ghcr.io/<owner>/my-mate-runtime-worker@sha256:<digest>
```

`latest`, untagged references, and custom mutable tags are not release
identities. They are accepted only when an operator explicitly enables the
local-only mutable-image override.

## Build Provenance

`npm run runtime-worker:image` records:

- `org.opencontainers.image.version`
- `org.opencontainers.image.revision`
- `org.opencontainers.image.created`
- `org.opencontainers.image.source`
- `io.my-mate.runtime-worker.version`
- `io.my-mate.runtime-protocol`

The same version, image reference, revision, build time, and source are exposed
by Runtime Worker `GET /health` and Worker registration metadata. Validate the
local image with:

```bash
npm run runtime-worker:verify-image
```

## CI And Release Gates

`.github/workflows/ci.yml` runs on pull requests and `main` pushes:

1. Install all locked package dependencies.
2. Verify generated OpenAPI contracts and TypeScript checks.
3. Run the deterministic repository test suite.

`.github/workflows/runtime-worker-release.yml` runs manually and for `v*` tags:

1. Verify tag and package version alignment.
2. Run release-script tests and syntax checks.
3. Build and verify the versioned local image.
4. Generate a CycloneDX JSON SBOM and SHA-256 digest.
5. Block Critical CVEs and retain a SARIF report.
6. Run deterministic Docker operator and restart-recovery smokes.
7. For a version tag, publish the image to GHCR with BuildKit provenance and
   SBOM attestations.
8. Sign the published digest using GitHub OIDC and cosign keyless signing, then
   verify the signature identity and issuer.

## Supply-Chain Policy

- Critical vulnerabilities block release.
- High vulnerabilities require an owner and remediation or accepted exception
  before the next production rollout.
- Exceptions must identify the CVE, affected package, runtime reachability,
  expiry date, and approver. Permanent blanket exceptions are not allowed.
- Base image updates require the full Docker release gate.
- SBOM, SARIF, image digest, build revision, and signature verification output
  are retained as release evidence.
- Signing is performed only against a published digest. Tags are never signed
  or deployed without resolving the digest.

Generate local evidence with:

```bash
npm run runtime-worker:sbom
npm run runtime-worker:scan
```

The local evidence commands use digest-pinned Syft and Grype containers and do
not require a Docker Hub account. The stock image uses the official Node 22
Alpine base; provider-specific images may select another compatible base but
must pass the same SBOM, Critical CVE, provenance, and Docker runtime gates.

## Upgrade Procedure

1. Create a version commit that keeps the repository and Runtime Worker package
   versions aligned.
2. Run the complete local checks and Docker smokes.
3. Push tag `v<version>` and wait for the release workflow to publish and sign
   the digest.
4. Verify the cosign identity, issuer, SBOM, vulnerability report, and image
   revision.
5. Set `MY_MATE_RUNTIME_WORKER_IMAGE` to the new digest in a canary Control
   Plane environment.
6. Run Docker Doctor, one deterministic operator Run, cleanup/recovery checks,
   and provider-specific opt-in acceptance where applicable.
7. Roll out the same digest progressively. Do not rebuild the same version for
   another environment.

Runtime data migrations must remain backward-readable before rollout. A Worker
image upgrade must not require destructive mutation of persisted Run, Job,
Lease, Evidence, or Trace records.

## Rollback Procedure

1. Select the last verified signed digest; do not use a tag as the rollback
   target.
2. Set `MY_MATE_RUNTIME_WORKER_IMAGE` to that digest and restart the Control
   Plane/Worker provisioning process.
3. Allow active Workers to finish or cancel them through the persisted control
   path; do not delete lease or compensation records manually.
4. Run Docker Doctor and restart-recovery smoke against the rollback digest.
5. Confirm queue depth, active capacity, cleanup failures, orphan containers,
   scorecard, trace, and replay posture.
6. Record the failed digest, rollback digest, affected Runs, and recovery
   evidence in the release incident.

If the new release writes a contract the previous release cannot read, rollback
is blocked and the release must use a forward compatibility fix. This is why
read compatibility is a release prerequisite.

## Verification Record

Verified on 2026-07-12:

- versioned image `my-mate-runtime-worker:0.1.0` built successfully
- OCI/image provenance verification passed
- CycloneDX JSON SBOM generated with a SHA-256 sidecar
- Grype Critical vulnerability gate passed
- actionlint passed both GitHub workflow files
- Docker Doctor and two-node operator smoke passed with `14/14` scorecard,
  evaluation, trace, and replay verification
- restart recovery removed the matched and orphan containers with zero
  remaining containers
- `npm run check` and `npm test` passed; the live provider test remained the
  expected explicit opt-in skip
