import { RetrievalAuditor } from "../src/auditor.js";
import { sha256 } from "../src/canonical.js";

export const fp = (label: string) => sha256(label).slice(0, 32);
export const ASOF = "2026-09-01T00:00:00Z";

/** The SPEC §9 worked example: a newly introduced, contradicted mirror at position 0. */
export function poisonedFixture(): RetrievalAuditor {
  const a = new RetrievalAuditor();
  a.indexSources({
    sources: [
      { sourceId: "pastebin-mirror", kind: "feed", firstSeen: "2026-08-29T00:00:00Z" },
      { sourceId: "wiki-internal", kind: "index", firstSeen: "2026-06-01T00:00:00Z", declaredSchema: { title: "string", body: "string" } },
      { sourceId: "ticket-system", kind: "index", firstSeen: "2026-02-01T00:00:00Z" },
      { sourceId: "runbooks", kind: "repository", firstSeen: "2025-11-01T00:00:00Z" },
    ],
  });
  a.recordSourceObservation({ sourceId: "pastebin-mirror", observedAt: "2026-08-30T00:00:00Z", contradictions: 3, corroborations: 0 });
  a.recordSourceObservation({ sourceId: "pastebin-mirror", observedAt: "2026-08-31T00:00:00Z", contradictions: 4, corroborations: 0 });
  a.recordSourceObservation({ sourceId: "pastebin-mirror", observedAt: "2026-08-31T06:00:00Z", contradictions: 5, corroborations: 0, retrievalOutcome: "failed" });
  for (const s of ["wiki-internal", "ticket-system", "runbooks"]) {
    for (let i = 1; i <= 4; i++) {
      a.recordSourceObservation({ sourceId: s, observedAt: `2026-08-2${i}T00:00:00Z`, corroborations: 6, contradictions: 0 });
    }
  }
  a.recordRetrieval({
    decisionId: "dec-4412",
    query: { digest: fp("query-escalation") },
    recordedAt: ASOF,
    assembly: [
      { position: 0, sourceId: "pastebin-mirror", chunkFingerprint: fp("c-poison"), retrievedAt: ASOF, sourceObservedAt: "2026-08-31T06:00:00Z", score: 0.81, transformations: ["summarize@1", "translate:en@2"] },
      { position: 1, sourceId: "wiki-internal", chunkFingerprint: fp("c-wiki"), retrievedAt: ASOF, sourceObservedAt: "2026-08-24T00:00:00Z", score: 0.72, transformations: [] },
      { position: 2, sourceId: "ticket-system", chunkFingerprint: fp("c-ticket"), retrievedAt: ASOF, sourceObservedAt: "2026-08-24T00:00:00Z", score: 0.55, transformations: ["chunk@1"] },
      { position: 3, sourceId: "runbooks", chunkFingerprint: fp("c-runbook"), retrievedAt: ASOF, sourceObservedAt: "2026-08-24T00:00:00Z", score: 0.4, transformations: ["summarize@1"] },
      { position: 4, sourceId: "runbooks", chunkFingerprint: fp("c-runbook-2"), retrievedAt: ASOF, sourceObservedAt: "2026-08-24T00:00:00Z", score: 0.3, transformations: [] },
    ],
    decision: { digest: fp("decision-escalated"), outcome: "escalated" },
  });
  return a;
}
