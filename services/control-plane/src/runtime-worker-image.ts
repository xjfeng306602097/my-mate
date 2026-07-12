export type RuntimeWorkerImageIdentityKind =
  | "digest"
  | "version_tag"
  | "latest"
  | "custom_tag"
  | "untagged";

export interface RuntimeWorkerImageIdentity {
  reference: string;
  kind: RuntimeWorkerImageIdentityKind;
  tag: string | null;
  digest: string | null;
  release_ready: boolean;
  expected_version: string;
}

export function describeRuntimeWorkerImage(
  reference: string,
  expectedVersion: string,
): RuntimeWorkerImageIdentity {
  const value = reference.trim();
  const digestMatch = value.match(/@sha256:([0-9a-f]{64})$/i);
  if (digestMatch) {
    return {
      reference: value,
      kind: "digest",
      tag: null,
      digest: `sha256:${digestMatch[1].toLowerCase()}`,
      release_ready: true,
      expected_version: expectedVersion,
    };
  }

  const tail = value.slice(value.lastIndexOf("/") + 1);
  const separator = tail.lastIndexOf(":");
  const tag = separator >= 0 ? tail.slice(separator + 1) : null;
  const versioned = !!tag && /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag);
  const kind: RuntimeWorkerImageIdentityKind = !tag
    ? "untagged"
    : tag.toLowerCase() === "latest"
      ? "latest"
      : versioned
        ? "version_tag"
        : "custom_tag";
  return {
    reference: value,
    kind,
    tag,
    digest: null,
    release_ready: kind === "version_tag" && tag?.replace(/^v/, "") === expectedVersion,
    expected_version: expectedVersion,
  };
}
