/**
 * SPEC §9 worked example, end to end. Run: bun examples/poisoned-source-investigation.ts
 */
import { RetrievalAuditor } from "../src/index.js";
import { verifyChain } from "../src/ledger.js";
import { sha256 } from "../src/canonical.js";

const fp = (s: string) => sha256(s).slice(0, 32);
const asOf = "2026-09-01T00:00:00Z";
const a = new RetrievalAuditor();

a.indexSources({
  sources: [
    { sourceId: "pastebin-mirror", kind: "feed", firstSeen: "2026-08-29T00:00:00Z" },
    { sourceId: "wiki-internal", kind: "index", firstSeen: "2026-06-01T00:00:00Z", declaredSchema: { title: "string", body: "string" } },
    { sourceId: "runbooks", kind: "repository", firstSeen: "2025-11-01T00:00:00Z" },
  ],
});

for (const [day, contradictions] of [["30", 3], ["31", 4]] as const) {
  a.recordSourceObservation({ sourceId: "pastebin-mirror", observedAt: `2026-08-${day}T00:00:00Z`, contradictions });
}
a.recordSourceObservation({ sourceId: "pastebin-mirror", observedAt: "2026-08-31T06:00:00Z", contradictions: 5, retrievalOutcome: "failed" });
for (let i = 1; i <= 4; i++) {
  a.recordSourceObservation({ sourceId: "wiki-internal", observedAt: `2026-08-2${i}T00:00:00Z`, corroborations: 6 });
  a.recordSourceObservation({ sourceId: "runbooks", observedAt: `2026-08-2${i}T00:00:00Z`, corroborations: 6 });
}

a.recordRetrieval({
  decisionId: "dec-4412",
  query: { digest: fp("why-escalate") },
  recordedAt: asOf,
  assembly: [
    { position: 0, sourceId: "pastebin-mirror", chunkFingerprint: fp("c-poison"), retrievedAt: asOf, sourceObservedAt: "2026-08-31T06:00:00Z", score: 0.81, transformations: ["summarize@1", "translate:en@2"] },
    { position: 1, sourceId: "wiki-internal", chunkFingerprint: fp("c-wiki"), retrievedAt: asOf, sourceObservedAt: "2026-08-24T00:00:00Z", score: 0.72 },
    { position: 2, sourceId: "runbooks", chunkFingerprint: fp("c-runbook"), retrievedAt: asOf, sourceObservedAt: "2026-08-24T00:00:00Z", score: 0.55, transformations: ["chunk@1"] },
  ],
  decision: { digest: fp("escalated"), outcome: "escalated" },
});

console.log(String((a.reportInfluence({ decisionId: "dec-4412", format: "text", asOf }) as any).text));
console.log("\ntrust:", JSON.stringify(a.scoreSource({ sourceId: "pastebin-mirror", asOf }), null, 2));
console.log("\ndrift:", JSON.stringify(a.checkRetrievalDrift({ sourceId: "wiki-internal", observedSchema: { title: "string", body: "string", authority: "string" } })));
const { records } = a.exportAuditRecords();
console.log("\naudit records:", records.length, "chain valid:", verifyChain(records).valid);
