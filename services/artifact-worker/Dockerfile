ARG MY_MATE_ARTIFACT_WORKER_BASE_IMAGE=python:3.12.11-slim-bookworm
FROM ${MY_MATE_ARTIFACT_WORKER_BASE_IMAGE}

ARG MY_MATE_ARTIFACT_WORKER_VERSION=0.1.0
ARG MY_MATE_ARTIFACT_WORKER_DEBIAN_MIRROR=
ARG MY_MATE_ARTIFACT_WORKER_DEBIAN_SECURITY_MIRROR=
ARG MY_MATE_ARTIFACT_WORKER_PIP_INDEX_URL=
ARG MY_MATE_ARTIFACT_WORKER_PIP_TRUSTED_HOST=

LABEL io.my-mate.artifact-worker="true" \
      io.my-mate.artifact-worker.version="${MY_MATE_ARTIFACT_WORKER_VERSION}" \
      org.opencontainers.image.title="My Mate Artifact Worker" \
      org.opencontainers.image.version="${MY_MATE_ARTIFACT_WORKER_VERSION}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp/artifact-worker-home

RUN rm -f /etc/apt/apt.conf.d/docker-clean
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    set -eux; \
    if [ -n "${MY_MATE_ARTIFACT_WORKER_DEBIAN_SECURITY_MIRROR}" ]; then \
      sed -i "s|http://deb.debian.org/debian-security|${MY_MATE_ARTIFACT_WORKER_DEBIAN_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi; \
    if [ -n "${MY_MATE_ARTIFACT_WORKER_DEBIAN_MIRROR}" ]; then \
      sed -i "s|http://deb.debian.org/debian|${MY_MATE_ARTIFACT_WORKER_DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi; \
    apt-get update \
    && apt-get install -y --no-install-recommends \
      fonts-noto-cjk \
      libreoffice-calc \
      libreoffice-impress \
      libreoffice-writer \
      poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/artifact-worker/requirements.txt ./requirements.txt
RUN set -eux; \
    pip_args=""; \
    if [ -n "${MY_MATE_ARTIFACT_WORKER_PIP_INDEX_URL}" ]; then \
      pip_args="${pip_args} --index-url ${MY_MATE_ARTIFACT_WORKER_PIP_INDEX_URL}"; \
    fi; \
    if [ -n "${MY_MATE_ARTIFACT_WORKER_PIP_TRUSTED_HOST}" ]; then \
      pip_args="${pip_args} --trusted-host ${MY_MATE_ARTIFACT_WORKER_PIP_TRUSTED_HOST}"; \
    fi; \
    pip install --no-cache-dir ${pip_args} --requirement requirements.txt

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    set -eux; \
    apt-get update \
    && apt-get install -y --no-install-recommends fonts-droid-fallback \
    && rm -rf /var/lib/apt/lists/*

COPY services/artifact-worker/worker.py ./worker.py

RUN useradd --create-home --uid 10001 artifact-worker \
    && mkdir -p /input /output /tmp/artifact-worker-home \
    && chown -R artifact-worker:artifact-worker /output /tmp/artifact-worker-home

USER artifact-worker
ENTRYPOINT ["python", "/app/worker.py"]
