# Security policy and threat model

## In scope

- retrieval / context supply-chain poisoning
- newly introduced or unvetted sources reaching a decision
- stale content driving current behaviour
- silent retrieval schema change
- post-incident reconstruction of contextual influence

## Out of scope

Proving a model *reasoned* from a chunk. Influence is attribution over recorded assembly and
observation evidence, not model interpretability. The mandatory `unexplained` residual exists
because of this limit.

## Refused capabilities

Fetching sources, executing queries, storing document text, outbound network calls, and
mutating or deleting a source. Retirement is always a recommendation to the operator.

## Data handling

Only digests, declared metadata, and structural facts are accepted. Errors carry a fixed
code and a fixed phrase from this package's own vocabulary — never a caller-supplied value.
Audit records are payload-free and hash-linked with SHA-256.

## Misuse boundary

This is an evidence tool for the operator's own agent systems. It cannot observe a
third-party system, and it holds no content that could be repurposed for surveillance of
document text.

## Reporting

Report a suspected vulnerability privately by opening a GitHub security advisory on this
repository, or by contacting the maintainer directly. Please do not open a public issue for a
suspected vulnerability before it has been triaged.
