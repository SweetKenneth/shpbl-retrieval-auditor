# SPEC — Retrieval Context Provenance Auditor

Status: **public behaviour specification, version 1.0.** Specification release only.
No implementation, Tenable listing, Exchange submission, PR, or Contribution Agreement
acceptance is authorized by this document.

Product form: MCP server + skill.
Written from product behaviour and capability intent. No harvested body was quoted,
translated, or structurally reproduced in producing this specification.

**Clean-room condition in force.** The source-trust / source-retirement layer (§6) is
specified by externally observable behaviour and properties only. This specification
contains no SHPBL-internal weighting constants, scoring curves, retirement thresholds,
tier vocabulary, or implementation structure, and none may be introduced during
implementation.

---

## 1. Purpose

After an agent makes a bad decision, nobody can answer the question that matters:
*which retrieved documents caused this, and were any of them poisoned, stale, or newly
introduced?*

This product records the retrieval supply chain — source → chunk → context → decision —
and answers that question afterwards with an auditable record: influence ranking,
lineage path, content fingerprints, source trust and freshness, co-influence
correlations, and retrieval schema drift.

Non-goal: performing retrieval, ranking documents for an agent at query time, or
blocking a decision.

## 2. Definitions

- **Source** — an origin of retrievable content (a repository, feed, index, upload).
- **Chunk** — a retrievable unit derived from a source, identified by content fingerprint.
- **Context assembly** — the ordered set of chunks placed in front of a model for one
  decision, with position and any transformation applied.
- **Decision** — the agent output being audited.
- **Influence** — the auditor's ranked attribution of a decision to the chunks and sources
  that entered its context.
- **Lineage** — the traversable edge graph source → chunk → transformation → context →
  decision.
- **Trust state** — the auditor's view of how reliable a source has been (§6).

## 3. Inputs

### 3.1 `index_sources`
```
{ "sources": [ { "sourceId": "wiki-internal", "kind": "index",
                 "firstSeen": "2026-06-01T00:00:00Z",
                 "declaredSchema": { … } } ] }
```

### 3.2 `record_retrieval`
```
{ "decisionId": "dec-4412",
  "query": { "digest": "9f2c…" },
  "assembly": [ { "position": 0, "sourceId": "wiki-internal",
                  "chunkFingerprint": "c30d…", "retrievedAt": "…",
                  "sourceObservedAt": "…", "score": 0.81,
                  "transformations": ["summarize@1", "translate:en@2"] } ],
  "decision": { "digest": "b881…", "outcome": "escalated" } }
```
Content is admitted as **digest plus caller-declared metadata**. Raw document text is
never required, never stored, and never exported.

### 3.3 `record_source_observation`
`{ sourceId, observedAt, corroborations, contradictions, retrievalOutcome }` — feeds §6.

### 3.4 `trace_decision`
`{ decisionId, maxDepth? }`

### 3.5 `score_source`
`{ sourceId, asOf? }`

### 3.6 `report_influence`
`{ decisionId, format: "json" | "text" }`

### 3.7 `check_retrieval_drift`
`{ sourceId, observedSchema }`

### 3.8 `describe_scoring_policy`
No input. Returns the implementation identifier and its fixed public
`maxObservationStep`, a number in `(0,1]`. The value is identical for every source and
call within an implementation version, is included in exported scoring metadata, and is
not caller-tunable.

## 4. Outputs

### 4.1 Influence report
```
{ "decisionId": "dec-4412",
  "ranked": [
    { "rank": 1, "chunkFingerprint": "c30d…", "sourceId": "pastebin-mirror",
      "influence": 0.44, "position": 0, "fidelity": 0.62,
      "sourceTrust": { "score": 0.19, "state": "distrusted",
                       "basis": ["contradiction-rate", "recency-of-introduction"] },
      "flags": ["newly-introduced", "uncorroborated"] },
    { "rank": 2, "chunkFingerprint": "4b81…", "sourceId": "wiki-internal",
      "influence": 0.31, "position": 1, "fidelity": 0.97,
      "sourceTrust": { "score": 0.88, "state": "trusted", "basis": ["corroboration"] },
      "flags": [] } ],
  "coInfluence": [ { "pair": ["c30d…", "4b81…"], "correlation": 0.71,
                     "sampleSize": 118 } ],
  "unexplained": 0.25,
  "recordDigest": "7e41…" }
```
`unexplained` is mandatory and never omitted: the residual the auditor cannot attribute.

### 4.2 Lineage trace
Node and edge lists with depth, transformation chain per path, and any broken edge
reported explicitly as `{ "edge": …, "status": "missing" }`.

### 4.3 Fidelity
Per multi-hop transformation path, a bounded `[0,1]` fidelity value that is
non-increasing along a path, with per-hop attribution.

### 4.4 Drift report
`{ sourceId, drift: [ { field, change: "added" | "removed" | "type-changed",
  declared, observed } ], severity }`

### 4.5 Audit record
A payload-free, hash-linked entry carrying digests, source ids, timestamps and the report
digest, produced with the same canonical form and chain rule as the Agent Action Evidence
Ledger so it verifies inside a ledger export unchanged.

## 5. Invariants

1. **Digest-only.** Raw document, chunk, query, and decision text is never stored or
   exported. Only fingerprints, declared metadata, and structural facts.
2. **Attribution honesty.** Influence values are bounded `[0,1]`, and reported influence
   plus `unexplained` sums to 1.0. The product never presents a complete explanation it
   cannot support.
3. **Fidelity monotonicity.** Fidelity is non-increasing along a transformation path.
4. **Lineage soundness.** A reported path exists in the recorded graph. Missing edges are
   reported as missing, never bridged, inferred, or hidden.
5. **Determinism.** Same recorded inputs ⇒ identical rankings, identical report digest.
6. **Correlation locality.** Co-influence is computed from this package's own recorded
   observations using a documented local function. No cross-primitive or external
   correlation dependency exists in the shipped surface.
7. **No retrieval.** The product never fetches a source, opens an index, or issues a query.
8. **Trust is advisory.** A trust state never blocks a decision; it annotates evidence.
9. **Explainability.** Every trust score and every influence rank carries a `basis` list of
   the observable factors that produced it.
10. **No egress.** No network call, no ambient filesystem write.

## 6. Source trust and retirement — behavioural specification (clean-room)

This section defines **only** externally observable behaviour and properties. No internal
weighting constants, curves, thresholds, or tier names from any prior implementation appear
here, and none may be reintroduced during implementation. Properties T1–T10 were authored
without opening the two private HARVEST source-trust bodies.

### 6.1 Inputs
Per source, from recorded observations: identifier, first-seen timestamp, observation
timestamps, corroboration count, contradiction count, retrieval-failure count, and the
age of the most recent observation.

### 6.2 Outputs
```
{ "sourceId": "pastebin-mirror",
  "score": 0.19,                       // bounded [0,1]
  "state": "distrusted",               // provisional | trusted | degraded | distrusted
  "freshness": "stale",                // fresh | aging | stale
  "retirement": { "recommended": true,
                  "basis": ["contradiction-rate", "staleness"] },
  "basis": ["corroboration", "contradiction-rate", "recency-of-introduction"],
  "confidence": "sufficient-observations",  // insufficient-observations | sufficient-observations
  "policy": { "implementation": "public-id", "maxObservationStep": 0.10 } }
```
`confidence` is exactly `insufficient-observations` or `sufficient-observations`. State and
freshness names above are this specification's own public vocabulary. Retirement
is always a **recommendation** to the operator; the product never removes a source.

### 6.3 Required properties (the actual contract)
| ID | Property |
|---|---|
| T1 | **Bounded:** score ∈ [0,1] for all inputs, including empty observation sets. |
| T2 | **Monotone in corroboration:** holding all else equal, more corroborations never decreases the score. |
| T3 | **Antitone in contradiction:** holding all else equal, more contradictions never increases the score. |
| T4 | **Antitone in age:** holding all else equal, a staler most-recent observation never increases the score. |
| T5 | **Continuity:** a single additional observation cannot move the score by more than `maxObservationStep` returned by `describe_scoring_policy`; that bound is fixed per implementation version, public, and not caller-tunable. |
| T6 | **Determinism:** identical observation sets, in any input order, yield identical output. |
| T7 | **Cold start:** a source with no observations is `provisional` with `insufficient-observations`, never `trusted`. |
| T8 | **Retirement requires basis:** `recommended: true` always carries at least one factor in `basis`. |
| T9 | **Recoverability:** a distrusted source that subsequently accumulates corroborations without contradictions must eventually leave `distrusted`. |
| T10 | **No hidden inputs:** score depends only on the §6.1 inputs — not on source name, kind, ordering, or wall-clock at call time other than the caller-supplied `asOf`. |

Implementation is verified against T1–T10, **not** against output equality with any prior
implementation. Comparing outputs to SHPBL internals is prohibited as a verification method.

## 7. Failure modes

| Condition | Behaviour |
|---|---|
| Retrieval recorded for an unknown source | `E_UNKNOWN_SOURCE`; nothing recorded |
| Duplicate `decisionId` | `E_CONFLICT`; existing record untouched |
| Raw text supplied where a digest is expected | `E_INPUT`; value never echoed |
| Lineage depth limit reached | partial trace with `truncated: true` and the depth reached |
| Co-influence sample below minimum | correlation omitted with `reason: "insufficient-sample"` |
| Observed schema unparseable | `E_INPUT` on `check_retrieval_drift` |
| First observed schema with no declared schema | baseline observation returned with `drift: []`, `severity: "info"`, and `baselineCreated: true` |
| Historical lineage references a retired or renamed source | original immutable source id remains in the trace with current status; the edge is not rewritten |
| Trust queried for a source with no observations | `provisional`, `insufficient-observations` |

## 8. Security boundaries

**In scope:** retrieval/context supply-chain poisoning, newly introduced or unvetted
sources reaching a decision, stale content driving current behaviour, silent retrieval
schema change, and post-incident reconstruction of contextual influence.

**Out of scope:** proving the model *reasoned* from a chunk. Influence is attribution over
recorded assembly and observation evidence, not model interpretability — §5.2's
`unexplained` residual exists precisely because of this limit.

**Refused capabilities:** fetching sources, executing queries, storing document text,
outbound calls, mutating or deleting a source.

## 9. Worked example

1. Four sources are indexed, including `pastebin-mirror`, first seen three days ago.
2. Decision `dec-4412` (an escalation) records a five-chunk assembly. Position 0 comes from
   `pastebin-mirror`, was summarized then translated, and has one prior contradiction and
   no corroborations.
3. `report_influence` ranks that chunk first at 0.44 influence with fidelity 0.62, flags
   `newly-introduced` and `uncorroborated`, and reports source trust 0.19 / `distrusted`.
4. `score_source("pastebin-mirror")` recommends retirement with basis
   `["contradiction-rate","staleness"]`.
5. `check_retrieval_drift` shows the source added an undeclared `authority` field two days
   ago — which is when its chunks began ranking at position 0.
6. The audit record is appended and verifies inside the operator's Evidence Ledger export.
   The investigator has a defensible poisoning finding without a single document body
   leaving the operator's systems.

## 10. Externally testable properties

| ID | Property |
|---|---|
| P1 | A poisoned-source fixture reaches rank 1 of the influence ranking. |
| P2 | Reported influence + `unexplained` = 1.0 ± 1e-9 on every report. |
| P3 | Fidelity is non-increasing along every transformation path in random synthetic graphs. |
| P4 | Lineage traces on synthetic graphs with known answers are exact; injected missing edges are reported as missing. |
| P5 | T1–T10 of §6.3 hold under property-based testing. |
| P6 | For inputs seeded with document text and secret-shaped values, no raw value appears in any record, report, error, or log. |
| P7 | A build-failing symbol scan finds no cross-primitive or foreign correlation dependency and no network symbol. |
| P8 | Identical recorded inputs produce an identical report digest across runs and platforms. |
| P9 | Audit records verify inside an Agent Action Evidence Ledger export unmodified. |
| P10 | Co-influence below the minimum sample is omitted with a stated reason rather than reported as 0. |
| P11 | Verification never compares output to any non-public reference implementation. |
