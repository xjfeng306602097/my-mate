# Unified Artifact Worker

## Scope

The Artifact Worker is the governed binary-file execution boundary for PDF,
DOCX, PPTX, and XLSX creation and conversion. It is separate from the Runtime
Worker and from executable Skill scripts. Skills supply instructions and
structured content; they never execute binary-generation code in the Control
Plane.

Media, archive, EPUB, and legacy Office adapters are not enabled by this
version. Requests for those formats must fail as unsupported rather than
inventing a file or download URL.

## Execution chain

1. Conversation resolves the requested output and source artifact.
2. Control Plane creates a T2 `artifact_worker_run` Conversation Action.
3. My Mate Desktop shows a one-time approval prompt with redacted arguments.
4. After approval, Control Plane prepares a private input directory. Existing
   source bytes are mounted read-only.
5. Docker starts `my-mate-artifact-worker:0.1.0` with no network, a read-only
   root file system, all Linux capabilities dropped, `no-new-privileges`, and
   bounded CPU, memory, process, and time limits.
6. The Worker writes only to `/output`, reopens the result with the matching
   format library, extracts bounded text, and renders a PDF preview.
7. Control Plane verifies the PDF magic or Office ZIP structure, size,
   SHA-256 digest, manifest paths, and PDF preview before persistence.
8. Only then does the Session receive an Artifact card, preview URL, and real
   download URL.

Studio accepts text/source attachments up to 512 KB and PDF, DOCX, PPTX, or
XLSX binary attachments up to 8 MB. Binary bytes are retained for the Worker,
not injected directly into a model prompt. A pure conversion uses the source
bytes without another model round. Translation or revision first extracts
bounded text inside the already-approved Worker, labels it as untrusted source
content for the model, and then regenerates the target in the Worker.

## Adapters

- PDF: ReportLab generation, PyMuPDF extraction, pypdf validation, and direct
  inline preview.
- DOCX: python-docx generation/extraction/validation and LibreOffice PDF
  preview.
- PPTX: python-pptx generation/extraction/validation and LibreOffice PDF
  preview.
- XLSX: openpyxl generation/extraction/validation, LibreOffice recalculation,
  conversion, and PDF preview.
- Office/PDF conversion: deterministic source-byte conversion through
  LibreOffice where supported, without another model round.

## Build and operation

Build the pinned image from the repository root:

```powershell
npm run artifact-worker:image
```

Verify the real isolated image contract and Chinese PDF extraction:

```powershell
npm run artifact-worker:smoke
```

The build uses the official Python base image and Python package index by
default. Environments that require controlled mirrors can override them
without changing the Dockerfile:

```powershell
$env:MY_MATE_ARTIFACT_WORKER_BASE_IMAGE="registry.example/python:3.12.11-slim-bookworm"
$env:MY_MATE_ARTIFACT_WORKER_DEBIAN_MIRROR="http://packages.example/debian"
$env:MY_MATE_ARTIFACT_WORKER_DEBIAN_SECURITY_MIRROR="http://packages.example/debian-security"
$env:MY_MATE_ARTIFACT_WORKER_PIP_INDEX_URL="https://packages.example/simple"
$env:MY_MATE_ARTIFACT_WORKER_PIP_TRUSTED_HOST="packages.example"
npm run artifact-worker:image
```

Override the image only through a deployment-controlled environment value:

```text
MY_MATE_ARTIFACT_WORKER_IMAGE=registry.example/my-mate-artifact-worker@sha256:...
```

Docker absence, a stopped daemon, a missing image, approval denial, invalid
output, or preview failure leaves the task incomplete with a bounded error.
There is no host-process fallback.
