// Canonical form + hashing. SHA-256 only, no other digest is produced anywhere.
import { createHash } from "node:crypto";

export const DIGEST_RE = /^[0-9a-f]{16,64}$/;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Deterministic canonical JSON: object keys sorted, no insignificant whitespace. */
export function canonical(value: Json): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AuditorError("E_INPUT", "non-finite number");
    // Fixed precision keeps digests identical across platforms.
    return JSON.stringify(Number(value.toFixed(12)));
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k]!)).join(",") + "}";
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function digestOf(value: Json): string {
  return sha256(canonical(value));
}

export type ErrorCode = "E_INPUT" | "E_UNKNOWN_SOURCE" | "E_CONFLICT" | "E_NOT_FOUND";

/**
 * Errors never carry caller values. `detail` is a fixed vocabulary phrase chosen by this
 * package, never interpolated from input (invariant 5.1, property P6).
 */
export class AuditorError extends Error {
  readonly code: ErrorCode;
  readonly field: string;
  constructor(code: ErrorCode, detail: string, field = "") {
    super(`${code}: ${detail}`);
    this.code = code;
    this.field = field;
    this.name = "AuditorError";
  }
  toJSON() {
    return { error: this.code, detail: this.message.slice(this.code.length + 2), field: this.field };
  }
}

export function requireDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    throw new AuditorError("E_INPUT", "expected lowercase hex digest", field);
  }
  return value;
}

export function requireId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new AuditorError("E_INPUT", "expected identifier", field);
  }
  return value;
}

export function requireTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new AuditorError("E_INPUT", "expected ISO-8601 timestamp", field);
  }
  return new Date(value).toISOString();
}

export function round(n: number, dp = 6): number {
  return Number(n.toFixed(dp));
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
