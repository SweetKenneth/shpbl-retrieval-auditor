/**
 * Transformation fidelity. SPEC §4.3 / invariant 5.3: bounded [0,1] and non-increasing
 * along a path, with per-hop attribution.
 */
import { clamp01, round } from "./canonical.js";

const HOP_FACTORS: Record<string, number> = {
  identity: 1.0,
  chunk: 0.95,
  redact: 0.85,
  translate: 0.9,
  summarize: 0.75,
  paraphrase: 0.7,
  extract: 0.8,
  rerank: 0.98,
};
const UNKNOWN_HOP = 0.6;

export interface Hop {
  step: number;
  transformation: string;
  kind: string;
  factor: number;
  fidelityAfter: number;
}

export function hopKind(transformation: string): string {
  // "summarize@1" / "translate:en@2" -> "summarize" / "translate"
  const head = transformation.split("@")[0]!.split(":")[0]!.trim().toLowerCase();
  return head in HOP_FACTORS ? head : "unknown";
}

export function fidelityPath(transformations: string[]): { fidelity: number; hops: Hop[] } {
  let value = 1;
  const hops: Hop[] = [];
  transformations.forEach((t, i) => {
    const kind = hopKind(t);
    const factor = kind === "unknown" ? UNKNOWN_HOP : HOP_FACTORS[kind]!;
    value = clamp01(value * factor); // factors are <= 1, so fidelity is non-increasing
    hops.push({ step: i + 1, transformation: t, kind, factor, fidelityAfter: round(value) });
  });
  return { fidelity: round(value), hops };
}
