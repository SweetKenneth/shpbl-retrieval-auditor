/**
 * Payload-free, hash-linked audit records (SPEC §4.5). The canonical form and chain rule
 * are the ones an Agent Action Evidence Ledger export uses, so a record verifies inside
 * such an export unchanged (P9).
 */
import { canonical, digestOf, Json, sha256 } from "./canonical.js";

export interface AuditRecord {
  seq: number;
  recordedAt: string;
  kind: string;
  sourceIds: string[];
  digests: Record<string, string>;
  reportDigest: string;
  prevHash: string;
  entryHash: string;
}

export const GENESIS_HASH = "0".repeat(64);

export function entryBody(r: Omit<AuditRecord, "entryHash">): Json {
  return {
    seq: r.seq,
    recordedAt: r.recordedAt,
    kind: r.kind,
    sourceIds: [...r.sourceIds].sort(),
    digests: r.digests as unknown as Json,
    reportDigest: r.reportDigest,
    prevHash: r.prevHash,
  };
}

export class AuditChain {
  private records: AuditRecord[] = [];

  append(input: {
    recordedAt: string;
    kind: string;
    sourceIds: string[];
    digests: Record<string, string>;
    reportDigest: string;
  }): AuditRecord {
    const prevHash = this.records.length ? this.records[this.records.length - 1]!.entryHash : GENESIS_HASH;
    const body = { seq: this.records.length + 1, prevHash, ...input };
    const entryHash = sha256(canonical(entryBody(body as Omit<AuditRecord, "entryHash">)));
    const record: AuditRecord = { ...(body as Omit<AuditRecord, "entryHash">), entryHash };
    this.records.push(record);
    return record;
  }

  export(): { records: AuditRecord[]; exportDigest: string } {
    return { records: [...this.records], exportDigest: digestOf(this.records as unknown as Json) };
  }

  get length(): number {
    return this.records.length;
  }
}

/** Independent verifier: usable by an operator on any export of these records. */
export function verifyChain(records: AuditRecord[]): { valid: boolean; brokenAt?: number; reason?: string } {
  let prev = GENESIS_HASH;
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.seq !== i + 1) return { valid: false, brokenAt: i + 1, reason: "sequence" };
    if (r.prevHash !== prev) return { valid: false, brokenAt: r.seq, reason: "chain-link" };
    const { entryHash, ...rest } = r;
    if (sha256(canonical(entryBody(rest))) !== entryHash) {
      return { valid: false, brokenAt: r.seq, reason: "entry-hash" };
    }
    prev = entryHash;
  }
  return { valid: true };
}
