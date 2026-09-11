# Retrieval Context Provenance Auditor — reference implementation

**Status: released under MIT.** This is the reference implementation of the public behaviour
specification at `https://github.com/SweetKenneth/shpbl-spec-retrieval-auditor`. It was written
fresh from that specification, then cleared an exact-file IP surface review and an explicit MIT
implementation grant naming that reviewed file set.

Not submitted to, reviewed by, approved by, or endorsed by Tenable or any other vendor.

## What it answers

After an agent makes a bad decision: *which retrieved documents caused it, and were any of
them poisoned, stale, or newly introduced?*

It records the retrieval supply chain — source → chunk → transformation → context →
decision — and afterwards reports influence ranking, lineage, transformation fidelity,
advisory source trust and retirement, co-influence correlation, and retrieval schema drift.

It never performs retrieval, never ranks documents for an agent at query time, and never
blocks a decision.

## Tool surface (MCP, stdio, zero dependencies)

| Tool | Purpose |
|---|---|
| `index_sources` | register sources with kind, first-seen and optional declared schema |
| `record_retrieval` | record one decision's assembly as digests plus declared metadata |
| `record_source_observation` | record corroborations, contradictions, retrieval outcome |
| `report_influence` | ranked influence with mandatory `unexplained` residual |
| `trace_decision` | lineage graph; missing edges reported as missing |
| `score_source` | advisory trust, freshness, retirement recommendation with basis |
| `check_retrieval_drift` | observed schema versus declared baseline |
| `describe_scoring_policy` | policy id and the fixed public `maxObservationStep` |
| `export_audit_records` | payload-free hash-linked audit records |

## Install and run

Prerequisites: [Bun](https://bun.sh) 1.1+ (or Node 22+ with a TypeScript loader). No install
step is required beyond the clone, because there are no runtime dependencies.

```bash
git clone https://github.com/SweetKenneth/shpbl-retrieval-auditor.git
cd shpbl-retrieval-auditor
bun install                    # dev types only
bun test                       # conformance suite
bun run scripts/symbol-scan.ts # build-failing forbidden-symbol scan
bun src/mcp-server.ts          # MCP server: newline-delimited JSON-RPC 2.0 on stdin/stdout
```

### MCP configuration

```json
{
  "mcpServers": {
    "shpbl-retrieval-auditor": {
      "command": "bun",
      "args": ["/absolute/path/to/shpbl-retrieval-auditor/src/mcp-server.ts"]
    }
  }
}
```

### Outputs

Every tool returns JSON: lineage graphs, ranked influence with an explicit `unexplained`
residual, advisory trust and retirement recommendations with their basis, drift findings, and a
payload-free hash-linked audit export. A worked poisoned-source example is in `examples/`.

## Boundaries held by construction

- **Digest-only.** Raw document, chunk, query and decision text is never accepted, stored or
  exported. Non-digest values are rejected as `E_INPUT` and never echoed back.
- **Attribution honesty.** Influence plus `unexplained` sums to exactly 1.0. The product
  never claims a complete explanation, because it observes assembly and observation
  evidence, not model reasoning.
- **Advisory trust.** A distrusted source is annotated, never withheld or removed.
- **No egress.** No network symbol, no ambient filesystem write, no process execution —
  enforced by a build-failing scan.
- **Clean-room trust layer.** Source trust and retirement are implemented from the public
  specification's properties T1–T10 only, and verified against those properties — never
  against output equality with any private implementation.

## Verification

31 conformance tests, 6,415 assertions: specification properties P1–P11 and trust
properties T1–T10, plus every §7 failure mode. Randomised checks use a seeded generator, so
runs are reproducible.

## Provenance

SHPBL discovers the invention; this package implements it from a written specification. See
`PROVENANCE.md`.

## Known limitations

- Influence attribution observes context assembly and observation evidence, not model
  reasoning. The reported `unexplained` residual is the honest share it cannot account for, and
  it is never suppressed.
- Source trust is advisory. The product annotates a distrusted source; it does not withhold,
  remove or block retrieval, and it never performs retrieval itself.
- Because only digests and declared metadata are accepted, the auditor can prove which
  recorded material a decision used, but it cannot recover the original document text — that
  remains with the operator's own systems.
- The hash-linked audit export detects edits to what was recorded; it cannot prove that a
  retrieval was recorded at all. External anchoring of the head digest is the operator's
  responsibility.

## Tenable status

Independent open-source project being prepared for submission to the Tenable CyberAgents
Exchange. Not submitted to, reviewed by, approved by, certified by, validated by or endorsed by
Tenable or any other vendor.

## SHPBL Agent Evidence series

Independently installable, interoperable at the evidence-record boundary:

- [shpbl-action-ledger](https://github.com/SweetKenneth/shpbl-action-ledger) — agent action evidence ledger
- [shpbl-handoff-attestor](https://github.com/SweetKenneth/shpbl-handoff-attestor) — cross-agent handoff attestation
- [shpbl-drift-sentinel](https://github.com/SweetKenneth/shpbl-drift-sentinel) — agent behaviour drift detection
- [shpbl-retrieval-auditor](https://github.com/SweetKenneth/shpbl-retrieval-auditor) — retrieval context provenance
- [shpbl-canary-chain](https://github.com/SweetKenneth/shpbl-canary-chain) — synthetic canary evidence chain

## Licence

MIT — Copyright (c) 2026 Kenneth E. Sweet Jr. See `LICENSE`.
