/** The MCP tool surface answers initialize/tools/list/tools/call and reports errors as codes. */
import { expect, test } from "bun:test";
import { RetrievalAuditor } from "../src/auditor.js";
import { callTool, TOOLS } from "../src/tools.js";
import { ASOF, fp } from "./fixtures.js";

test("every specified tool is exposed with a schema", () => {
  const names = TOOLS.map((t) => t.name).sort();
  expect(names).toEqual(
    [
      "check_retrieval_drift",
      "describe_scoring_policy",
      "export_audit_records",
      "index_sources",
      "record_retrieval",
      "record_source_observation",
      "report_influence",
      "score_source",
      "trace_decision",
    ].sort(),
  );
  for (const t of TOOLS) {
    expect(t.description.length).toBeGreaterThan(20);
    expect(t.inputSchema.type).toBe("object");
  }
});

test("a full tool sequence runs end to end", () => {
  const a = new RetrievalAuditor();
  callTool(a, "index_sources", { sources: [{ sourceId: "s", kind: "index", firstSeen: "2026-01-01T00:00:00Z" }] });
  callTool(a, "record_source_observation", { sourceId: "s", observedAt: ASOF, corroborations: 2 });
  callTool(a, "record_retrieval", {
    decisionId: "d1",
    query: { digest: fp("q") },
    recordedAt: ASOF,
    assembly: [{ position: 0, sourceId: "s", chunkFingerprint: fp("c"), retrievedAt: ASOF, score: 0.6 }],
    decision: { digest: fp("d"), outcome: "answered" },
  });
  const report: any = callTool(a, "report_influence", { decisionId: "d1", asOf: ASOF });
  expect(report.ranked.length).toBe(1);
  const policy: any = callTool(a, "describe_scoring_policy", {});
  expect(policy.implementation).toContain("shpbl-retrieval-auditor");
  expect(() => callTool(a, "does_not_exist", {})).toThrow("E_INPUT");
});
