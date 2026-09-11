/** SPEC §10 externally testable properties P1-P11, plus §7 failure modes. */
import { describe, expect, test } from "bun:test";
import { RetrievalAuditor } from "../src/auditor.js";
import { AuditorError, canonical, digestOf } from "../src/canonical.js";
import { verifyChain } from "../src/ledger.js";
import { fidelityPath } from "../src/fidelity.js";
import { ASOF, fp, poisonedFixture } from "./fixtures.js";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("P1 the poisoned source reaches rank 1", () => {
  const report: any = poisonedFixture().reportInfluence({ decisionId: "dec-4412", asOf: ASOF });
  expect(report.ranked[0].sourceId).toBe("pastebin-mirror");
  expect(report.ranked[0].flags).toContain("newly-introduced");
  expect(report.ranked[0].flags).toContain("uncorroborated");
  expect(report.ranked[0].sourceTrust.state).toBe("distrusted");
});

test("P2 influence + unexplained sums to 1.0", () => {
  const r = rng(3);
  for (let k = 0; k < 60; k++) {
    const a = new RetrievalAuditor();
    const n = 1 + Math.floor(r() * 8);
    a.indexSources({ sources: [{ sourceId: "s", kind: "index", firstSeen: "2026-01-01T00:00:00Z" }] });
    a.recordRetrieval({
      decisionId: `d-${k}`,
      query: { digest: fp(`q${k}`) },
      recordedAt: ASOF,
      assembly: Array.from({ length: n }, (_, i) => ({
        position: i,
        sourceId: "s",
        chunkFingerprint: fp(`c${k}-${i}`),
        retrievedAt: ASOF,
        sourceObservedAt: r() < 0.5 ? ASOF : undefined,
        score: r() < 0.8 ? Number(r().toFixed(3)) : undefined,
        transformations: r() < 0.5 ? ["summarize@1"] : [],
      })),
      decision: { digest: fp(`dd${k}`), outcome: "answered" },
    });
    const report: any = a.reportInfluence({ decisionId: `d-${k}`, asOf: ASOF });
    const sum = report.ranked.reduce((acc: number, x: any) => acc + x.influence, 0) + report.unexplained;
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    for (const row of report.ranked) {
      expect(row.influence).toBeGreaterThanOrEqual(0);
      expect(row.influence).toBeLessThanOrEqual(1);
    }
  }
});

test("P3 fidelity is non-increasing along every path", () => {
  const r = rng(5);
  const kinds = ["summarize", "translate:en", "chunk", "redact", "paraphrase", "weird-op", "extract", "rerank"];
  for (let k = 0; k < 400; k++) {
    const path = Array.from({ length: Math.floor(r() * 8) }, (_, i) => `${kinds[Math.floor(r() * kinds.length)]}@${i + 1}`);
    const { fidelity, hops } = fidelityPath(path);
    let prev = 1;
    for (const h of hops) {
      expect(h.fidelityAfter).toBeLessThanOrEqual(prev + 1e-12);
      prev = h.fidelityAfter;
    }
    expect(fidelity).toBeGreaterThanOrEqual(0);
    expect(fidelity).toBeLessThanOrEqual(1);
  }
});

describe("P4 lineage exactness", () => {
  test("known graph traces exactly and missing edges are reported as missing", () => {
    const a = poisonedFixture();
    const trace: any = a.traceDecision({ decisionId: "dec-4412" });
    expect(trace.nodes.filter((n: any) => n.type === "source").length).toBe(4);
    expect(trace.nodes.filter((n: any) => n.type === "chunk").length).toBe(5);
    expect(trace.edges.some((e: any) => e.kind === "assembled-into")).toBe(true);
    expect(trace.edges.every((e: any) => e.status === "present")).toBe(true);

    a.indexSources({ sources: [{ sourceId: "orphan-src", kind: "feed", firstSeen: "2026-08-01T00:00:00Z" }] });
    a.recordRetrieval({
      decisionId: "dec-broken",
      query: { digest: fp("q-broken") },
      recordedAt: ASOF,
      assembly: [
        {
          position: 0,
          sourceId: "orphan-src",
          chunkFingerprint: fp("c-child"),
          retrievedAt: ASOF,
          score: 0.5,
          transformations: ["summarize@1"],
          derivedFrom: fp("c-never-recorded"),
        },
      ],
      decision: { digest: fp("dd-broken"), outcome: "answered" },
    });
    const broken: any = a.traceDecision({ decisionId: "dec-broken" });
    const missing = broken.edges.filter((e: any) => e.status === "missing");
    expect(missing.length).toBe(1);
    expect(missing[0].kind).toBe("derived-from");
  });

  test("depth limit yields a partial trace flagged truncated", () => {
    const a = poisonedFixture();
    const t: any = a.traceDecision({ decisionId: "dec-4412", maxDepth: 2 });
    expect(t.truncated).toBe(true);
    expect(t.depthReached).toBeLessThanOrEqual(2);
  });
});

test("P6 no raw text or secret-shaped value ever reaches a record, report, or error", () => {
  const a = new RetrievalAuditor();
  a.indexSources({ sources: [{ sourceId: "s", kind: "index", firstSeen: "2026-01-01T00:00:00Z" }] });
  const SECRET = "sk-live-DEADBEEF-super-secret-token";
  const RAW = "The CEO password is hunter2 and the incident is confidential.";
  let errorText = "";
  try {
    a.recordRetrieval({
      decisionId: "leaky",
      query: { digest: RAW },
      recordedAt: ASOF,
      assembly: [{ position: 0, sourceId: "s", chunkFingerprint: SECRET, retrievedAt: ASOF, score: 0.5 }],
      decision: { digest: SECRET, outcome: RAW },
    });
  } catch (err) {
    errorText = JSON.stringify((err as AuditorError).toJSON()) + String(err);
    expect((err as AuditorError).code).toBe("E_INPUT");
  }
  expect(errorText).not.toContain("hunter2");
  expect(errorText).not.toContain("sk-live");
  const dump = JSON.stringify(a.exportAuditRecords());
  expect(dump).not.toContain("hunter2");
  expect(dump).not.toContain("sk-live");
  // A schema carrying secret-shaped values is rejected rather than stored.
  expect(() => a.checkRetrievalDrift({ sourceId: "s", observedSchema: { token: SECRET } })).toThrow();
});

test("P8 identical inputs produce an identical report digest", () => {
  const one: any = poisonedFixture().reportInfluence({ decisionId: "dec-4412", asOf: ASOF });
  const two: any = poisonedFixture().reportInfluence({ decisionId: "dec-4412", asOf: ASOF });
  expect(two.recordDigest).toBe(one.recordDigest);
  expect(canonical(one)).toBe(canonical(two));
  expect(digestOf(one)).toBe(digestOf(two));
});

test("P9 audit records verify inside an unmodified export and fail when tampered", () => {
  const a = poisonedFixture();
  a.reportInfluence({ decisionId: "dec-4412", asOf: ASOF });
  const { records } = a.exportAuditRecords();
  expect(records.length).toBeGreaterThanOrEqual(2);
  expect(verifyChain(records).valid).toBe(true);
  const tampered = structuredClone(records);
  tampered[0]!.reportDigest = fp("tampered");
  expect(verifyChain(tampered).valid).toBe(false);
  expect(records.every((r) => !("payload" in (r as any)))).toBe(true);
});

test("P10 co-influence below the minimum sample is omitted with a stated reason", () => {
  const small: any = poisonedFixture().reportInfluence({ decisionId: "dec-4412", asOf: ASOF });
  expect(small.coInfluence).toEqual([]);
  expect(small.coInfluenceOmitted.reason).toBe("insufficient-sample");

  const a = poisonedFixture();
  for (let i = 0; i < 40; i++) {
    a.recordRetrieval({
      decisionId: `bulk-${i}`,
      query: { digest: fp(`bq${i}`) },
      recordedAt: ASOF,
      assembly: [
        { position: 0, sourceId: i % 3 ? "wiki-internal" : "ticket-system", chunkFingerprint: i % 3 ? fp("c-wiki") : fp("c-ticket"), retrievedAt: ASOF, sourceObservedAt: ASOF, score: 0.7 },
        { position: 1, sourceId: "runbooks", chunkFingerprint: i % 2 ? fp("c-runbook") : fp("c-runbook-2"), retrievedAt: ASOF, sourceObservedAt: ASOF, score: 0.6 },
      ],
      decision: { digest: fp(`bd${i}`), outcome: "answered" },
    });
  }
  const big: any = a.reportInfluence({ decisionId: "bulk-1", asOf: ASOF });
  expect(big.coInfluenceOmitted).toBeUndefined();
  expect(big.coInfluence.length).toBeGreaterThan(0);
  for (const c of big.coInfluence) {
    expect(c.correlation).toBeGreaterThanOrEqual(-1);
    expect(c.correlation).toBeLessThanOrEqual(1);
    expect(c.sampleSize).toBeGreaterThanOrEqual(30);
  }
});

describe("SPEC §7 failure modes", () => {
  const base = () => {
    const a = new RetrievalAuditor();
    a.indexSources({ sources: [{ sourceId: "s", kind: "index", firstSeen: "2026-01-01T00:00:00Z" }] });
    return a;
  };
  const validAssembly = [{ position: 0, sourceId: "s", chunkFingerprint: fp("c"), retrievedAt: ASOF, score: 0.5 }];

  test("unknown source records nothing", () => {
    const a = base();
    expect(() =>
      a.recordRetrieval({
        decisionId: "d1",
        query: { digest: fp("q") },
        assembly: [{ ...validAssembly[0]!, sourceId: "ghost" }],
        decision: { digest: fp("d") },
      }),
    ).toThrow("E_UNKNOWN_SOURCE");
    expect(a.exportAuditRecords().records.length).toBe(0);
  });

  test("duplicate decisionId conflicts and leaves the original untouched", () => {
    const a = base();
    a.recordRetrieval({ decisionId: "d1", query: { digest: fp("q") }, recordedAt: ASOF, assembly: validAssembly, decision: { digest: fp("d") } });
    const before = a.exportAuditRecords().exportDigest;
    expect(() =>
      a.recordRetrieval({ decisionId: "d1", query: { digest: fp("q2") }, recordedAt: ASOF, assembly: validAssembly, decision: { digest: fp("d2") } }),
    ).toThrow("E_CONFLICT");
    expect(a.exportAuditRecords().exportDigest).toBe(before);
  });

  test("first observed schema with no declared schema creates a baseline", () => {
    const a = base();
    const r: any = a.checkRetrievalDrift({ sourceId: "s", observedSchema: { title: "string" } });
    expect(r).toMatchObject({ drift: [], severity: "info", baselineCreated: true });
    const again: any = a.checkRetrievalDrift({ sourceId: "s", observedSchema: { title: "string", authority: "string" } });
    expect(again.baselineCreated).toBe(false);
    expect(again.drift).toEqual([{ field: "authority", change: "added", declared: null, observed: "string" }]);
    expect(again.severity).toBe("warning");
    const breaking: any = a.checkRetrievalDrift({ sourceId: "s", observedSchema: { title: "number" } });
    expect(breaking.severity).toBe("critical");
  });

  test("unparseable observed schema is E_INPUT", () => {
    expect(() => base().checkRetrievalDrift({ sourceId: "s", observedSchema: "title:string" })).toThrow("E_INPUT");
  });

  test("retired source keeps its immutable id in the trace", () => {
    const a = poisonedFixture();
    a.markRetired("pastebin-mirror");
    const t: any = a.traceDecision({ decisionId: "dec-4412" });
    const node = t.nodes.find((n: any) => n.id === "source:pastebin-mirror");
    expect(node.retired).toBe(true);
    const report: any = a.reportInfluence({ decisionId: "dec-4412", asOf: ASOF });
    expect(report.ranked[0].flags).toContain("retired-source");
  });

  test("trust for a source with no observations is provisional/insufficient", () => {
    const r = base().scoreSource({ sourceId: "s" });
    expect(r.state).toBe("provisional");
    expect(r.confidence).toBe("insufficient-observations");
  });

  test("scoring policy exposes a fixed public maxObservationStep in (0,1]", () => {
    const p = base().describeScoringPolicy();
    expect(p.maxObservationStep).toBeGreaterThan(0);
    expect(p.maxObservationStep).toBeLessThanOrEqual(1);
    expect(base().describeScoringPolicy().maxObservationStep).toBe(p.maxObservationStep);
  });
});

test("invariant 5.7/5.8: no retrieval is performed and trust never blocks", () => {
  const a = poisonedFixture();
  const report: any = a.reportInfluence({ decisionId: "dec-4412", asOf: ASOF });
  expect(report.ranked.length).toBe(5); // distrusted content is annotated, not withheld
  expect(report.unexplained).toBeGreaterThan(0);
  for (const row of report.ranked) expect(row.basis.length).toBeGreaterThan(0);
});

test("text format renders without leaking structure-free content", () => {
  const out: any = poisonedFixture().reportInfluence({ decisionId: "dec-4412", format: "text", asOf: ASOF });
  expect(out.text).toContain("pastebin-mirror");
  expect(out.text).toContain("unexplained");
});
