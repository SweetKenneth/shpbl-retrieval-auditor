/** SPEC §6.3 properties T1-T10 (P5). No output is compared to any private implementation (P11). */
import { describe, expect, test } from "bun:test";
import { MAX_OBSERVATION_STEP, Observation, scoreSource } from "../src/trust.js";

const DAY = 86_400_000;
const ASOF = "2026-09-01T00:00:00Z";
const FIRST = "2026-01-01T00:00:00Z";

function obs(daysAgo: number, corroborations = 0, contradictions = 0, outcome: Observation["retrievalOutcome"] = "ok"): Observation {
  return {
    sourceId: "s",
    observedAt: new Date(Date.parse(ASOF) - daysAgo * DAY).toISOString(),
    corroborations,
    contradictions,
    retrievalOutcome: outcome,
  };
}

const score = (observations: Observation[], firstSeen = FIRST, asOf = ASOF) =>
  scoreSource({ sourceId: "s", firstSeen, observations, asOf });

// Deterministic pseudo-random generator: no Math.random anywhere in the suite.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("T1 bounded", () => {
  test("score is within [0,1] for empty and extreme inputs", () => {
    expect(score([]).score).toBeGreaterThanOrEqual(0);
    expect(score([]).score).toBeLessThanOrEqual(1);
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const n = Math.floor(r() * 12);
      const set = Array.from({ length: n }, () =>
        obs(Math.floor(r() * 400), Math.floor(r() * 50), Math.floor(r() * 50), r() < 0.2 ? "failed" : "ok"),
      );
      const s = score(set).score;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

test("T2 monotone in corroboration", () => {
  let prev = -1;
  for (let c = 0; c <= 40; c++) {
    const s = score([obs(1, c, 2)]).score;
    expect(s).toBeGreaterThanOrEqual(prev);
    prev = s;
  }
});

test("T3 antitone in contradiction", () => {
  let prev = 2;
  for (let x = 0; x <= 40; x++) {
    const s = score([obs(1, 3, x)]).score;
    expect(s).toBeLessThanOrEqual(prev);
    prev = s;
  }
});

test("T4 antitone in age of most recent observation", () => {
  let prev = 2;
  for (const age of [0, 1, 5, 10, 30, 90, 365, 1000]) {
    const s = score([obs(age, 3, 0)]).score;
    expect(s).toBeLessThanOrEqual(prev + 1e-12);
    prev = s;
  }
});

test("T5 continuity: one added observation moves the score by at most maxObservationStep", () => {
  const r = rng(11);
  for (let i = 0; i < 2000; i++) {
    const n = Math.floor(r() * 10);
    const set = Array.from({ length: n }, () =>
      obs(1 + Math.floor(r() * 300), Math.floor(r() * 9), Math.floor(r() * 9), r() < 0.25 ? "failed" : "ok"),
    );
    const extra = obs(Math.floor(r() * 300), Math.floor(r() * 9), Math.floor(r() * 9), r() < 0.25 ? "empty" : "ok");
    const before = score(set).score;
    const after = score([...set, extra]).score;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(MAX_OBSERVATION_STEP + 1e-9);
  }
});

test("T6 determinism under reordering", () => {
  const set = [obs(2, 4, 1), obs(30, 0, 3, "failed"), obs(9, 7, 0), obs(100, 1, 1)];
  const a = JSON.stringify(score(set));
  const shuffles = [
    [3, 1, 0, 2],
    [2, 0, 3, 1],
    [1, 3, 2, 0],
  ];
  for (const order of shuffles) {
    expect(JSON.stringify(score(order.map((i) => set[i]!)))).toBe(a);
  }
});

test("T7 cold start is provisional and never trusted", () => {
  const r = score([]);
  expect(r.state).toBe("provisional");
  expect(r.confidence).toBe("insufficient-observations");
  const one = score([obs(0, 99, 0)]);
  expect(one.state).toBe("provisional");
  expect(one.confidence).toBe("insufficient-observations");
});

test("T8 retirement recommendation always carries a basis factor", () => {
  const r = rng(23);
  for (let i = 0; i < 800; i++) {
    const n = Math.floor(r() * 10);
    const set = Array.from({ length: n }, () =>
      obs(Math.floor(r() * 500), Math.floor(r() * 6), Math.floor(r() * 8), r() < 0.4 ? "failed" : "ok"),
    );
    const out = score(set);
    if (out.retirement.recommended) expect(out.retirement.basis.length).toBeGreaterThan(0);
  }
});

test("T9 recoverability: corroborations without contradictions leave distrusted", () => {
  const poisoned = Array.from({ length: 6 }, () => obs(5, 0, 6));
  expect(score(poisoned).state).toBe("distrusted");
  const recovered = [...poisoned];
  for (let i = 0; i < 200 && score(recovered).state === "distrusted"; i++) {
    recovered.push(obs(0, 5, 0));
  }
  expect(score(recovered).state).not.toBe("distrusted");
});

test("T10 no hidden inputs: name, kind and call-time clock are irrelevant", () => {
  const set = [obs(3, 2, 1), obs(8, 1, 0), obs(20, 0, 2)];
  const a = scoreSource({ sourceId: "alpha", firstSeen: FIRST, observations: set, asOf: ASOF });
  const b = scoreSource({ sourceId: "zeta-mirror-untrusted", firstSeen: FIRST, observations: set, asOf: ASOF });
  expect(b.score).toBe(a.score);
  expect(b.state).toBe(a.state);
  const later = scoreSource({ sourceId: "alpha", firstSeen: FIRST, observations: set, asOf: "2026-12-31T00:00:00Z" });
  expect(later.score).not.toBe(a.score); // only the caller-supplied asOf may change it
});

test("policy metadata is published and bounded in (0,1]", () => {
  const p = score([]).policy;
  expect(p.maxObservationStep).toBeGreaterThan(0);
  expect(p.maxObservationStep).toBeLessThanOrEqual(1);
  expect(p.implementation.length).toBeGreaterThan(0);
});
