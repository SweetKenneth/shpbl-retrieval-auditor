/** Tool surface shared by the MCP server and the skill. Eight tools, SPEC §3. */
import { RetrievalAuditor } from "./auditor.js";
import { AuditorError, Json } from "./canonical.js";

export const TOOLS = [
  {
    name: "index_sources",
    description: "Register retrievable sources with kind, first-seen time and optional declared schema.",
    inputSchema: {
      type: "object",
      required: ["sources"],
      properties: {
        sources: {
          type: "array",
          items: {
            type: "object",
            required: ["sourceId", "firstSeen"],
            properties: {
              sourceId: { type: "string" },
              kind: { type: "string" },
              firstSeen: { type: "string" },
              declaredSchema: { type: "object" },
            },
          },
        },
      },
    },
  },
  {
    name: "record_retrieval",
    description: "Record one decision's context assembly as digests plus declared metadata. Never accepts document text.",
    inputSchema: {
      type: "object",
      required: ["decisionId", "query", "assembly", "decision"],
      properties: {
        decisionId: { type: "string" },
        query: { type: "object", required: ["digest"], properties: { digest: { type: "string" } } },
        assembly: { type: "array", items: { type: "object" } },
        decision: { type: "object", required: ["digest"], properties: { digest: { type: "string" }, outcome: { type: "string" } } },
      },
    },
  },
  {
    name: "record_source_observation",
    description: "Record a corroboration/contradiction/failure observation about a source.",
    inputSchema: {
      type: "object",
      required: ["sourceId", "observedAt"],
      properties: {
        sourceId: { type: "string" },
        observedAt: { type: "string" },
        corroborations: { type: "integer" },
        contradictions: { type: "integer" },
        retrievalOutcome: { type: "string", enum: ["ok", "failed", "empty"] },
      },
    },
  },
  {
    name: "trace_decision",
    description: "Traverse the source -> chunk -> transformation -> context -> decision lineage graph.",
    inputSchema: {
      type: "object",
      required: ["decisionId"],
      properties: { decisionId: { type: "string" }, maxDepth: { type: "integer" } },
    },
  },
  {
    name: "score_source",
    description: "Advisory source trust, freshness and retirement recommendation with an explicit basis.",
    inputSchema: {
      type: "object",
      required: ["sourceId"],
      properties: { sourceId: { type: "string" }, asOf: { type: "string" } },
    },
  },
  {
    name: "report_influence",
    description: "Ranked influence attribution for a recorded decision, with mandatory unexplained residual.",
    inputSchema: {
      type: "object",
      required: ["decisionId"],
      properties: { decisionId: { type: "string" }, format: { type: "string", enum: ["json", "text"] }, asOf: { type: "string" } },
    },
  },
  {
    name: "check_retrieval_drift",
    description: "Compare an observed source schema against its declared baseline.",
    inputSchema: {
      type: "object",
      required: ["sourceId", "observedSchema"],
      properties: { sourceId: { type: "string" }, observedSchema: { type: "object" } },
    },
  },
  {
    name: "describe_scoring_policy",
    description: "Return the trust policy identifier and its fixed public maxObservationStep.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "export_audit_records",
    description: "Export the payload-free hash-linked audit records produced so far.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

export function callTool(auditor: RetrievalAuditor, name: string, args: any): Json {
  switch (name) {
    case "index_sources":
      return auditor.indexSources(args) as unknown as Json;
    case "record_retrieval":
      return auditor.recordRetrieval(args) as unknown as Json;
    case "record_source_observation":
      return auditor.recordSourceObservation(args) as unknown as Json;
    case "trace_decision":
      return auditor.traceDecision(args);
    case "score_source":
      return auditor.scoreSource(args) as unknown as Json;
    case "report_influence":
      return auditor.reportInfluence(args);
    case "check_retrieval_drift":
      return auditor.checkRetrievalDrift(args);
    case "describe_scoring_policy":
      return auditor.describeScoringPolicy() as unknown as Json;
    case "export_audit_records":
      return auditor.exportAuditRecords() as unknown as Json;
    default:
      throw new AuditorError("E_INPUT", "unknown tool", "name");
  }
}
