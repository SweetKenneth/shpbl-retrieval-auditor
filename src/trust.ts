/**
 * Source trust and retirement.
 *
 * CLEAN-ROOM: written from SPEC §6 properties T1-T10 only. No weighting constant, curve,
 * threshold or tier name from any prior implementation appears here, and no output is ever
 * compared against a non-public reference implementation (P11).
 *
 * Shape of the score (all constants are this package's own, published here):
 *   score = clamp01( BASE + SUPPORT*(1-e^(-c/K)) - CONTRA*(1-e^(-x/K))
 *                         - FAIL*(1-e^(-f/KF)) - STALE*(1-e^(-ageDays/AGE_K)) )
 * where c, x, f are per-observation-saturated counts: each observation contributes at most
 * 1.0 to each of them, which is what makes the T5 step bound provable.
 *
 * T5 bound proof (max movement from adding one observation):
 *   upward   <= SUPPORT*(1-e^(-1/K)) + STALE            = 0.0844 + 0.10 = 0.1844
 *   downward <= CONTRA*(1-e^(-1/K)) + FAIL*(1-e^(-1/KF)) = 0.0691 + 0.0118 = 0.0809
 * Published bound MAX_OBSERVATION_STEP = 0.20 dominates both.
 */
import { clamp01, requireId, requireTimestamp, round, AuditorError } from "./canonical.js";

export const POLICY_ID = "shpbl-retrieval-auditor/trust-policy-1";
export const MAX_OBSERVATION_STEP = 0.2;

const BASE = 0.35;
const SUPPORT = 0.55;
const CONTRA = 0.45;
const FAIL = 0.1;
const K = 6;
const KF = 8;
const AGE_K = 30;
const STALE = 0.1;

const MIN_OBSERVATIONS = 3;
const TRUSTED_AT = 0.65;
const DEGRADED_AT = 0.3;
const FRESH_DAYS = 7;
const AGING_DAYS = 30;
const DAY_MS = 86_400_000;

export type RetrievalOutcome = "ok" | "failed" | "empty";

export interface Observation {
  sourceId: string;
  observedAt: string;
  corroborations: number;
  contradictions: number;
  retrievalOutcome: RetrievalOutcome;
}

export type TrustState = "provisional" | "trusted" | "degraded" | "distrusted";
export type Freshness = "fresh" | "aging" | "stale";

export interface TrustResult {
  sourceId: string;
  score: number;
  state: TrustState;
  freshness: Freshness;
  retirement: { recommended: boolean; basis: string[] };
  basis: string[];
  confidence: "insufficient-observations" | "sufficient-observations";
  policy: { implementation: string; maxObservationStep: number };
}

export function parseObservation(raw: any): Observation {
  const sourceId = requireId(raw?.sourceId, "sourceId");
  const observedAt = requireTimestamp(raw?.observedAt, "observedAt");
  const corroborations = nonNegInt(raw?.corroborations ?? 0, "corroborations");
  const contradictions = nonNegInt(raw?.contradictions ?? 0, "contradictions");
  const outcome = raw?.retrievalOutcome ?? "ok";
  if (outcome !== "ok" && outcome !== "failed" && outcome !== "empty") {
    throw new AuditorError("E_INPUT", "retrievalOutcome must be ok|failed|empty", "retrievalOutcome");
  }
  return { sourceId, observedAt, corroborations, contradictions, retrievalOutcome: outcome };
}

function nonNegInt(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 1e9) {
    throw new AuditorError("E_INPUT", "expected non-negative integer", field);
  }
  return v;
}

/**
 * T6/T10: depends only on the SPEC §6.1 inputs. Input order is irrelevant because every
 * aggregate below is order-free and the age term uses max(observedAt).
 */
export function scoreSource(args: {
  sourceId: string;
  firstSeen: string;
  observations: Observation[];
  asOf: string;
}): TrustResult {
  const { sourceId, firstSeen, observations, asOf } = args;
  const asOfMs = Date.parse(asOf);

  let c = 0;
  let x = 0;
  let f = 0;
  let lastMs = -Infinity;
  for (const o of observations) {
    c += 1 - Math.exp(-o.corroborations); // <= 1 per observation
    x += 1 - Math.exp(-o.contradictions); // <= 1 per observation
    if (o.retrievalOutcome !== "ok") f += 1;
    lastMs = Math.max(lastMs, Date.parse(o.observedAt));
  }

  const n = observations.length;
  const ageDays = n === 0 ? 0 : Math.max(0, (asOfMs - lastMs) / DAY_MS);
  const introDays = Math.max(0, (asOfMs - Date.parse(firstSeen)) / DAY_MS);

  const support = SUPPORT * (1 - Math.exp(-c / K));
  const contra = CONTRA * (1 - Math.exp(-x / K));
  const fails = FAIL * (1 - Math.exp(-f / KF));
  const stale = n === 0 ? 0 : STALE * (1 - Math.exp(-ageDays / AGE_K));

  const score = round(clamp01(BASE + support - contra - fails - stale));
  const sufficient = n >= MIN_OBSERVATIONS;

  // T7: no observations => provisional, never trusted.
  const state: TrustState = !sufficient
    ? "provisional"
    : score >= TRUSTED_AT
      ? "trusted"
      : score >= DEGRADED_AT
        ? "degraded"
        : "distrusted";

  const freshness: Freshness =
    n === 0 ? "stale" : ageDays <= FRESH_DAYS ? "fresh" : ageDays <= AGING_DAYS ? "aging" : "stale";

  // T9: every basis factor is an observable §6.1 input, never an opaque weight.
  const basis: string[] = [];
  if (c > 0) basis.push("corroboration");
  if (x > 0) basis.push("contradiction-rate");
  if (f > 0) basis.push("retrieval-failure-rate");
  if (freshness !== "fresh") basis.push("staleness");
  if (introDays <= FRESH_DAYS) basis.push("recency-of-introduction");
  if (!sufficient) basis.push("observation-count");

  const retirementBasis: string[] = [];
  if (state === "distrusted") retirementBasis.push("contradiction-rate");
  if (freshness === "stale" && sufficient) retirementBasis.push("staleness");
  if (sufficient && f >= 3 && f >= n / 2) retirementBasis.push("retrieval-failure-rate");
  // T8: a recommendation without a basis factor is impossible by construction.
  const recommended = retirementBasis.length > 0;

  return {
    sourceId,
    score,
    state,
    freshness,
    retirement: { recommended, basis: retirementBasis },
    basis,
    confidence: sufficient ? "sufficient-observations" : "insufficient-observations",
    policy: { implementation: POLICY_ID, maxObservationStep: MAX_OBSERVATION_STEP },
  };
}
