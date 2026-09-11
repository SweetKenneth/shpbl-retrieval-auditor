/**
 * Retrieval Context Provenance Auditor — reference implementation of
 * SPEC-retrieval-context-provenance-auditor v1.0.
 *
 * Invariants held by construction:
 *  - digest-only: no raw text field is ever accepted, stored, or exported (5.1)
 *  - no retrieval, no network, no ambient filesystem write (5.7, 5.10)
 *  - trust is advisory: nothing here blocks or rewrites a decision (5.8)
 */
import {
  AuditorError,
  Json,
  clamp01,
  digestOf,
  requireDigest,
  requireId,
  requireTimestamp,
  round,
} from "./canonical.js";
import { fidelityPath, Hop } from "./fidelity.js";
import { AuditChain, AuditRecord } from "./ledger.js";
import {
  MAX_OBSERVATION_STEP,
  Observation,
  POLICY_ID,
  parseObservation,
  scoreSource,
  TrustResult,
} from "./trust.js";

const MIN_CO_INFLUENCE_SAMPLE = 30;
const DEFAULT_MAX_DEPTH = 64;
/**
 * Context position dominates attribution: earlier placement in the assembled window is the
 * strongest recorded structural signal available without model interpretability.
 */
const POSITION_DECAY = 0.5;
const BASE_UNEXPLAINED = 0.1;
const UNEXPLAINED_PER_GAP = 0.02;
const MAX_UNEXPLAINED = 0.5;

export interface SourceRecord {
  sourceId: string;
  kind: string;
  firstSeen: string;
  declaredSchema: Record<string, string> | null;
  baselineCreatedAt: string | null;
  retired: boolean;
}

export interface AssemblyEntry {
  position: number;
  sourceId: string;
  chunkFingerprint: string;
  retrievedAt: string;
  sourceObservedAt: string | null;
  score: number | null;
  transformations: string[];
  derivedFrom: string | null;
}

export interface DecisionRecord {
  decisionId: string;
  queryDigest: string;
  decisionDigest: string;
  outcome: string;
  recordedAt: string;
  assembly: AssemblyEntry[];
}

export class RetrievalAuditor {
  private sources = new Map<string, SourceRecord>();
  private decisions = new Map<string, DecisionRecord>();
  private observations: Observation[] = [];
  private knownChunks = new Set<string>();
  readonly chain = new AuditChain();

  // ---------------------------------------------------------------- inputs

  indexSources(input: any): { indexed: string[]; alreadyKnown: string[] } {
    const list = Array.isArray(input?.sources) ? input.sources : null;
    if (!list) throw new AuditorError("E_INPUT", "sources must be an array", "sources");
    const indexed: string[] = [];
    const alreadyKnown: string[] = [];
    for (const raw of list) {
      const sourceId = requireId(raw?.sourceId, "sourceId");
      const kind = requireId(raw?.kind ?? "index", "kind");
      const firstSeen = requireTimestamp(raw?.firstSeen, "firstSeen");
      const declaredSchema = raw?.declaredSchema == null ? null : parseSchema(raw.declaredSchema, "declaredSchema");
      if (this.sources.has(sourceId)) {
        alreadyKnown.push(sourceId);
        continue;
      }
      this.sources.set(sourceId, {
        sourceId,
        kind,
        firstSeen,
        declaredSchema,
        baselineCreatedAt: null,
        retired: false,
      });
      indexed.push(sourceId);
    }
    return { indexed: indexed.sort(), alreadyKnown: alreadyKnown.sort() };
  }

  /** Retirement is operator-driven and never deletes: the immutable id stays traceable. */
  markRetired(sourceId: string): SourceRecord {
    const s = this.sources.get(requireId(sourceId, "sourceId"));
    if (!s) throw new AuditorError("E_UNKNOWN_SOURCE", "source not indexed", "sourceId");
    s.retired = true;
    return s;
  }

  recordRetrieval(input: any): { decisionId: string; chunks: number; auditRecord: AuditRecord } {
    const decisionId = requireId(input?.decisionId, "decisionId");
    const queryDigest = requireDigest(input?.query?.digest, "query.digest");
    const decisionDigest = requireDigest(input?.decision?.digest, "decision.digest");
    const outcome = requireId(input?.decision?.outcome ?? "unspecified", "decision.outcome");
    const rawAssembly = Array.isArray(input?.assembly) ? input.assembly : null;
    if (!rawAssembly || rawAssembly.length === 0) {
      throw new AuditorError("E_INPUT", "assembly must be a non-empty array", "assembly");
    }
    if (this.decisions.has(decisionId)) {
      throw new AuditorError("E_CONFLICT", "decisionId already recorded", "decisionId");
    }

    const assembly: AssemblyEntry[] = rawAssembly.map((raw: any, i: number) => {
      const sourceId = requireId(raw?.sourceId, "assembly.sourceId");
      if (!this.sources.has(sourceId)) {
        throw new AuditorError("E_UNKNOWN_SOURCE", "source not indexed", "assembly.sourceId");
      }
      const position = raw?.position == null ? i : raw.position;
      if (typeof position !== "number" || !Number.isInteger(position) || position < 0) {
        throw new AuditorError("E_INPUT", "position must be a non-negative integer", "assembly.position");
      }
      const score = raw?.score == null ? null : numberIn01(raw.score, "assembly.score");
      const transformations = parseTransformations(raw?.transformations);
      return {
        position,
        sourceId,
        chunkFingerprint: requireDigest(raw?.chunkFingerprint, "assembly.chunkFingerprint"),
        retrievedAt: requireTimestamp(raw?.retrievedAt, "assembly.retrievedAt"),
        sourceObservedAt: raw?.sourceObservedAt == null ? null : requireTimestamp(raw.sourceObservedAt, "assembly.sourceObservedAt"),
        score,
        transformations,
        derivedFrom: raw?.derivedFrom == null ? null : requireDigest(raw.derivedFrom, "assembly.derivedFrom"),
      };
    });

    const recordedAt = requireTimestamp(input?.recordedAt ?? assembly[0]!.retrievedAt, "recordedAt");
    const record: DecisionRecord = { decisionId, queryDigest, decisionDigest, outcome, recordedAt, assembly };
    this.decisions.set(decisionId, record);
    for (const e of assembly) this.knownChunks.add(e.chunkFingerprint);

    const auditRecord = this.chain.append({
      recordedAt,
      kind: "retrieval-recorded",
      sourceIds: [...new Set(assembly.map((e) => e.sourceId))],
      digests: { query: queryDigest, decision: decisionDigest },
      reportDigest: digestOf(this.decisionShape(record)),
    });
    return { decisionId, chunks: assembly.length, auditRecord };
  }

  recordSourceObservation(input: any): { sourceId: string; observations: number } {
    const observation = parseObservation(input);
    if (!this.sources.has(observation.sourceId)) {
      throw new AuditorError("E_UNKNOWN_SOURCE", "source not indexed", "sourceId");
    }
    this.observations.push(observation);
    return { sourceId: observation.sourceId, observations: this.observationsFor(observation.sourceId).length };
  }

  // ---------------------------------------------------------------- reads

  describeScoringPolicy(): { implementation: string; maxObservationStep: number; inputs: string[]; verification: string } {
    return {
      implementation: POLICY_ID,
      maxObservationStep: MAX_OBSERVATION_STEP,
      inputs: [
        "sourceId",
        "firstSeen",
        "observedAt",
        "corroborations",
        "contradictions",
        "retrievalOutcome",
        "asOf",
      ],
      verification: "properties T1-T10 of the public specification; never output equality with any private implementation",
    };
  }

  scoreSource(input: any): TrustResult {
    const sourceId = requireId(input?.sourceId, "sourceId");
    const source = this.sources.get(sourceId);
    if (!source) throw new AuditorError("E_UNKNOWN_SOURCE", "source not indexed", "sourceId");
    const asOf = input?.asOf == null ? this.latestKnownTime() : requireTimestamp(input.asOf, "asOf");
    return scoreSource({
      sourceId,
      firstSeen: source.firstSeen,
      observations: this.observationsFor(sourceId),
      asOf,
    });
  }

  reportInfluence(input: any): Json {
    const decisionId = requireId(input?.decisionId, "decisionId");
    const format = input?.format ?? "json";
    if (format !== "json" && format !== "text") {
      throw new AuditorError("E_INPUT", "format must be json|text", "format");
    }
    const decision = this.decisions.get(decisionId);
    if (!decision) throw new AuditorError("E_NOT_FOUND", "decision not recorded", "decisionId");
    const asOf = input?.asOf == null ? this.latestKnownTime() : requireTimestamp(input.asOf, "asOf");

    const rows = decision.assembly.map((e) => {
      const { fidelity, hops } = fidelityPath(e.transformations);
      const declared = e.score == null ? 0.5 : e.score;
      const weight = declared * (1 / (1 + POSITION_DECAY * e.position)) * fidelity;
      return { entry: e, fidelity, hops, weight };
    });

    const gaps = decision.assembly.filter((e) => e.score == null || e.sourceObservedAt == null).length;
    const unexplained = round(
      clamp01(Math.min(MAX_UNEXPLAINED, BASE_UNEXPLAINED + UNEXPLAINED_PER_GAP * gaps)),
    );
    const explained = 1 - unexplained;
    const total = rows.reduce((a, r) => a + r.weight, 0);

    const ordered = [...rows].sort(
      (a, b) =>
        b.weight - a.weight ||
        a.entry.position - b.entry.position ||
        a.entry.chunkFingerprint.localeCompare(b.entry.chunkFingerprint),
    );

    const shares = ordered.map((r) => (total === 0 ? explained / ordered.length : (r.weight / total) * explained));
    const rounded = shares.map((s) => round(s, 9));
    // Invariant 5.2: influence + unexplained sums to exactly 1.0 (residual folded into rank 1).
    const drift = round(explained - rounded.reduce((a, b) => a + b, 0), 12);
    if (rounded.length) rounded[0] = round(rounded[0]! + drift, 12);

    const ranked = ordered.map((r, i) => {
      const trust = this.scoreSource({ sourceId: r.entry.sourceId, asOf });
      const source = this.sources.get(r.entry.sourceId)!;
      const flags: string[] = [];
      const introDays = (Date.parse(asOf) - Date.parse(source.firstSeen)) / 86_400_000;
      if (introDays <= 7) flags.push("newly-introduced");
      if (!this.observationsFor(r.entry.sourceId).some((o) => o.corroborations > 0)) flags.push("uncorroborated");
      if (trust.freshness === "stale") flags.push("stale-source");
      if (source.retired) flags.push("retired-source");
      if (r.entry.score == null || r.entry.sourceObservedAt == null) flags.push("incomplete-metadata");
      return {
        rank: i + 1,
        chunkFingerprint: r.entry.chunkFingerprint,
        sourceId: r.entry.sourceId,
        influence: round(rounded[i]!, 9),
        position: r.entry.position,
        fidelity: r.fidelity,
        hops: r.hops as unknown as Json,
        sourceTrust: { score: trust.score, state: trust.state, basis: trust.basis },
        basis: influenceBasis(r.entry, r.fidelity),
        flags,
      };
    });

    const co = this.coInfluence(decision);
    const body: Record<string, Json> = {
      decisionId,
      policy: { implementation: POLICY_ID, maxObservationStep: MAX_OBSERVATION_STEP },
      ranked: ranked as unknown as Json,
      coInfluence: co.pairs as unknown as Json,
      unexplained,
    };
    if (co.omitted) body["coInfluenceOmitted"] = co.omitted as unknown as Json;
    const recordDigest = digestOf(body as Json);
    const report = { ...body, recordDigest } as Json;

    this.chain.append({
      recordedAt: asOf,
      kind: "influence-reported",
      sourceIds: [...new Set(decision.assembly.map((e) => e.sourceId))],
      digests: { query: decision.queryDigest, decision: decision.decisionDigest },
      reportDigest: recordDigest,
    });

    return format === "text" ? ({ decisionId, text: renderText(report), recordDigest } as Json) : report;
  }

  traceDecision(input: any): Json {
    const decisionId = requireId(input?.decisionId, "decisionId");
    const decision = this.decisions.get(decisionId);
    if (!decision) throw new AuditorError("E_NOT_FOUND", "decision not recorded", "decisionId");
    const maxDepth =
      input?.maxDepth == null
        ? DEFAULT_MAX_DEPTH
        : (() => {
            const d = input.maxDepth;
            if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > DEFAULT_MAX_DEPTH) {
              throw new AuditorError("E_INPUT", `maxDepth must be an integer in 1..${DEFAULT_MAX_DEPTH}`, "maxDepth");
            }
            return d;
          })();

    const nodes: Json[] = [];
    const edges: Json[] = [];
    const seen = new Set<string>();
    let truncated = false;
    let depthReached = 0;
    const push = (id: string, type: string, depth: number, extra: Record<string, Json> = {}) => {
      if (seen.has(id)) return;
      seen.add(id);
      nodes.push({ id, type, depth, ...extra });
    };
    const edge = (from: string, to: string, depth: number, kind: string, status = "present") => {
      if (depth > maxDepth) {
        truncated = true;
        return;
      }
      depthReached = Math.max(depthReached, depth);
      edges.push({ from, to, depth, kind, status });
    };

    push(`decision:${decisionId}`, "decision", 0, { outcome: decision.outcome, digest: decision.decisionDigest });
    push(`context:${decisionId}`, "context", 1, { chunks: decision.assembly.length });
    edge(`context:${decisionId}`, `decision:${decisionId}`, 1, "assembled-into");

    for (const e of decision.assembly) {
      const chunkNode = `chunk:${e.chunkFingerprint}`;
      const sourceNode = `source:${e.sourceId}`;
      const src = this.sources.get(e.sourceId)!;
      push(sourceNode, "source", 4, { kind: src.kind, retired: src.retired, firstSeen: src.firstSeen });
      push(chunkNode, "chunk", 3, { position: e.position });
      let tail = chunkNode;
      const { hops } = fidelityPath(e.transformations);
      hops.forEach((h) => {
        const tNode = `transform:${e.chunkFingerprint}:${h.step}`;
        push(tNode, "transformation", 2, { transformation: h.transformation, kind: h.kind, factor: h.factor });
        edge(tail, tNode, 2 + h.step, "transformed-by");
        tail = tNode;
      });
      edge(tail, `context:${decisionId}`, 2, "placed-at-position");
      edge(sourceNode, chunkNode, 4, "produced");
      // Invariant 5.4: a declared parent that was never recorded is reported missing, not bridged.
      if (e.derivedFrom) {
        const parent = `chunk:${e.derivedFrom}`;
        const present = this.knownChunks.has(e.derivedFrom);
        if (present) push(parent, "chunk", 5, {});
        edge(parent, chunkNode, 5, "derived-from", present ? "present" : "missing");
      }
    }

    return {
      decisionId,
      nodes: nodes.sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))) as Json,
      edges: edges.sort((a: any, b: any) =>
        `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`),
      ) as Json,
      truncated,
      depthReached,
      maxDepth,
    };
  }

  checkRetrievalDrift(input: any): Json {
    const sourceId = requireId(input?.sourceId, "sourceId");
    const source = this.sources.get(sourceId);
    if (!source) throw new AuditorError("E_UNKNOWN_SOURCE", "source not indexed", "sourceId");
    const observed = parseSchema(input?.observedSchema, "observedSchema");

    if (!source.declaredSchema) {
      source.declaredSchema = observed;
      source.baselineCreatedAt = this.latestKnownTime();
      return { sourceId, drift: [], severity: "info", baselineCreated: true };
    }

    const declared = source.declaredSchema;
    const drift: Json[] = [];
    for (const field of Object.keys(declared).sort()) {
      if (!(field in observed)) drift.push({ field, change: "removed", declared: declared[field]!, observed: null });
      else if (observed[field] !== declared[field]) {
        drift.push({ field, change: "type-changed", declared: declared[field]!, observed: observed[field]! });
      }
    }
    for (const field of Object.keys(observed).sort()) {
      if (!(field in declared)) drift.push({ field, change: "added", declared: null, observed: observed[field]! });
    }
    const kinds = new Set(drift.map((d: any) => d.change));
    const severity = drift.length === 0 ? "info" : kinds.has("removed") || kinds.has("type-changed") ? "critical" : "warning";
    return { sourceId, drift: drift as Json, severity, baselineCreated: false };
  }

  exportAuditRecords() {
    return this.chain.export();
  }

  // ---------------------------------------------------------------- internals

  private observationsFor(sourceId: string): Observation[] {
    return this.observations.filter((o) => o.sourceId === sourceId);
  }

  private latestKnownTime(): string {
    let ms = 0;
    for (const o of this.observations) ms = Math.max(ms, Date.parse(o.observedAt));
    for (const d of this.decisions.values()) ms = Math.max(ms, Date.parse(d.recordedAt));
    for (const s of this.sources.values()) ms = Math.max(ms, Date.parse(s.firstSeen));
    return new Date(ms).toISOString();
  }

  private decisionShape(d: DecisionRecord): Json {
    return {
      decisionId: d.decisionId,
      queryDigest: d.queryDigest,
      decisionDigest: d.decisionDigest,
      outcome: d.outcome,
      assembly: d.assembly.map((e) => ({
        position: e.position,
        sourceId: e.sourceId,
        chunkFingerprint: e.chunkFingerprint,
        transformations: e.transformations,
      })),
    } as Json;
  }

  /**
   * Invariant 5.6: co-influence uses only this package's own recorded decisions and a
   * documented local function (phi coefficient over chunk co-occurrence).
   */
  private coInfluence(decision: DecisionRecord): {
    pairs: Json[];
    omitted?: { reason: string; sampleSize: number; minimumSampleSize: number };
  } {
    const decisions = [...this.decisions.values()];
    const sampleSize = decisions.length;
    if (sampleSize < MIN_CO_INFLUENCE_SAMPLE) {
      return {
        pairs: [],
        omitted: { reason: "insufficient-sample", sampleSize, minimumSampleSize: MIN_CO_INFLUENCE_SAMPLE },
      };
    }
    const presence = new Map<string, boolean[]>();
    const fingerprints = [...new Set(decision.assembly.map((e) => e.chunkFingerprint))].sort();
    for (const fp of fingerprints) {
      presence.set(fp, decisions.map((d) => d.assembly.some((e) => e.chunkFingerprint === fp)));
    }
    const pairs: Json[] = [];
    for (let i = 0; i < fingerprints.length; i++) {
      for (let j = i + 1; j < fingerprints.length; j++) {
        const a = presence.get(fingerprints[i]!)!;
        const b = presence.get(fingerprints[j]!)!;
        const correlation = phi(a, b);
        if (correlation == null) continue;
        pairs.push({ pair: [fingerprints[i]!, fingerprints[j]!], correlation: round(correlation), sampleSize });
      }
    }
    return { pairs };
  }
}

// ------------------------------------------------------------------ helpers

function phi(a: boolean[], b: boolean[]): number | null {
  let n11 = 0;
  let n10 = 0;
  let n01 = 0;
  let n00 = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) n11++;
    else if (a[i]) n10++;
    else if (b[i]) n01++;
    else n00++;
  }
  const denom = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));
  if (denom === 0) return null; // degenerate: reported as absent, never as 0 correlation
  return (n11 * n00 - n10 * n01) / denom;
}

function influenceBasis(e: AssemblyEntry, fidelity: number): string[] {
  const basis = ["context-position"];
  if (e.score != null) basis.push("retrieval-score");
  else basis.push("default-retrieval-score");
  if (e.transformations.length) basis.push("transformation-fidelity");
  if (fidelity < 1) basis.push("fidelity-loss");
  return basis;
}

function numberIn01(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new AuditorError("E_INPUT", "expected number in [0,1]", field);
  }
  return v;
}

function parseTransformations(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new AuditorError("E_INPUT", "transformations must be an array", "transformations");
  return v.map((t) => {
    if (typeof t !== "string" || t.length === 0 || t.length > 64 || /\s/.test(t)) {
      throw new AuditorError("E_INPUT", "transformation label must be a short whitespace-free string", "transformations");
    }
    return t;
  });
}

/** Schemas are field->type maps only: never document content. */
function parseSchema(v: unknown, field: string): Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new AuditorError("E_INPUT", "schema must be a field-to-type object", field);
  }
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
    if (typeof t !== "string" || t.length === 0 || t.length > 32) {
      throw new AuditorError("E_INPUT", "schema values must be short type names", field);
    }
    if (k.length > 128) throw new AuditorError("E_INPUT", "schema field name too long", field);
    out[k] = t;
  }
  return out;
}

function renderText(report: any): string {
  const lines = [`decision ${report.decisionId}`];
  for (const r of report.ranked) {
    lines.push(
      `#${r.rank} chunk ${r.chunkFingerprint.slice(0, 8)} source ${r.sourceId} ` +
        `influence ${r.influence.toFixed(3)} fidelity ${r.fidelity.toFixed(2)} ` +
        `trust ${r.sourceTrust.score.toFixed(2)}/${r.sourceTrust.state}` +
        (r.flags.length ? ` flags ${r.flags.join(",")}` : ""),
    );
  }
  lines.push(`unexplained ${report.unexplained.toFixed(3)}`);
  return lines.join("\n");
}

export { AuditorError };
