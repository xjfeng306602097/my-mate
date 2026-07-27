# Artifact Transform

Use when modifying an existing generated artifact or attachment.

1. Resolve the exact target from explicit name, recent artifact lineage, language, and type.
2. Stop for user choice if multiple candidates remain plausible.
3. Apply the requested transformation to the entire file; deterministic PDF/Office conversions must preserve and convert the real source bytes in the Artifact Worker.
4. Preserve unrelated content and generate a version linked to the source artifact.
5. Report Preview, Download, and Show Diff evidence only after persistence.
