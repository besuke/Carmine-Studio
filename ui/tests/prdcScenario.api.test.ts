import { describe, expect, inject, it } from "vitest";

// POST /api/prdc/scenario (chapter II-9): the cross terms and the second-order approximation of the PRDC note.
// The check that does not use the scenario code: the full revaluation equals the closed-form value of POST /api/prdc at the moved inputs
// minus the value at the base inputs. The rest are identities of the expansion and the scaling of the Taylor remainder.

const baseUrl = inject("apiBaseUrl");
const post = async (path: string, body: unknown) => {
  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const scenario = async (shock: Record<string, number>, note: Record<string, number> = {}) =>
  (await post("/api/prdc/scenario", { note, shock })).json;
const ZERO = { spotYen: 0, volPoints: 0, domesticBp: 0, foreignBp: 0, discountBp: 0 };
const sum = (c: { kind: string; value: number }[], kinds: string[]) => c.filter((x) => kinds.includes(x.kind)).reduce((a, x) => a + x.value, 0);

describe("II-9 scenario", () => {
  it("the base value is the closed-form value of the note", async () => {
    const s = await scenario(ZERO);
    const note = (await post("/api/prdc", {})).json;
    expect(s.base.npv).toBeCloseTo(note.note.closed.npv, 2);
  });

  it("the full revaluation equals the closed form of /api/prdc at the moved inputs", async () => {
    const shock = { spotYen: 5, volPoints: 2, domesticBp: 20, foreignBp: -20, discountBp: 20 };
    const s = await scenario(shock);
    const base = (await post("/api/prdc", {})).json.note;
    const moved = (await post("/api/prdc", { note: {
      spot: 133.2681 + shock.spotYen, volPct: 10 + shock.volPoints, domesticPct: 1 + shock.domesticBp / 100,
      foreignPct: 3 + shock.foreignBp / 100, discountPct: 0.5 + shock.discountBp / 100 } })).json.note;
    expect(s.pnl.full).toBeCloseTo(moved.closed.npv - base.closed.npv, 1);
  });

  it("no move, no P&L", async () => {
    const s = await scenario(ZERO);
    for (const k of ["full", "first_order", "first_plus_cross", "second_order"]) expect(Math.abs(s.pnl[k]), k).toBeLessThan(1e-6);
    for (const c of s.contribution) expect(Math.abs(c.value), c.short).toBeLessThan(1e-6);
  });

  it("the contributions add up to the three approximations, and the differences are against the full revaluation", async () => {
    const s = await scenario({ spotYen: 5, volPoints: 2, domesticBp: 20, foreignBp: -20, discountBp: 20 });
    expect(s.contribution).toHaveLength(14);
    expect(s.contribution.map((c: any) => c.kind)).toEqual([..."1111".split("").map(() => "first"), "cross", "cross", "cross", ..."1111111".split("").map(() => "second")]);
    expect(sum(s.contribution, ["first"])).toBeCloseTo(s.pnl.first_order, 4);
    expect(sum(s.contribution, ["first", "cross"])).toBeCloseTo(s.pnl.first_plus_cross, 4);
    expect(sum(s.contribution, ["first", "cross", "second"])).toBeCloseTo(s.pnl.second_order, 4);
    expect(s.pnl.difference_first_order).toBeCloseTo(s.pnl.full - s.pnl.first_order, 4);
    expect(s.pnl.difference_first_plus_cross).toBeCloseTo(s.pnl.full - s.pnl.first_plus_cross, 4);
    expect(s.pnl.difference_second_order).toBeCloseTo(s.pnl.full - s.pnl.second_order, 4);
  });

  it("a move of the spot alone has no cross terms, and the first order equals first plus cross", async () => {
    const s = await scenario({ ...ZERO, spotYen: 5 });
    for (const c of s.contribution.filter((x: any) => x.kind === "cross")) expect(c.value === 0 || Math.abs(c.value) < 1e-6, c.short).toBe(true);
    expect(s.pnl.first_plus_cross).toBeCloseTo(s.pnl.first_order, 4);
    const nonzero = s.contribution.filter((x: any) => x.kind === "second" && Math.abs(x.value) > 1e-6);
    expect(nonzero).toHaveLength(1); // only the gamma
  });

  it("the remainder falls faster for the second order than for the first order when the move is halved", async () => {
    const big = { spotYen: 4, volPoints: 1.6, domesticBp: 16, foreignBp: -16, discountBp: 16 };
    const half = Object.fromEntries(Object.entries(big).map(([k, v]) => [k, v / 2]));
    const a = await scenario(big), b = await scenario(half);
    const first = Math.abs(a.pnl.difference_first_order) / Math.abs(b.pnl.difference_first_order);
    const second = Math.abs(a.pnl.difference_second_order) / Math.abs(b.pnl.difference_second_order);
    expect(first).toBeGreaterThan(3); // second-order remainder of the first order: about x4
    expect(second).toBeGreaterThan(first); // third-order remainder of the expansion: faster than x4
    expect(Math.abs(a.pnl.difference_second_order)).toBeLessThan(Math.abs(a.pnl.difference_first_order));
  });

  it("validation: an out-of-range input or note is a 400 with a message", async () => {
    for (const body of [{ shock: { spotYen: 100 } }, { shock: { volPoints: -20 } }, { shock: { discountBp: 500 } }, { shock: { foo: 1 } }, { note: { spot: 1000 } }, { note: { capPct: -1 } }]) {
      const r = await post("/api/prdc/scenario", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(typeof r.json.error).toBe("string");
    }
    expect((await fetch(`${baseUrl}/api/prdc/scenario`)).status).toBe(405);
  });
});
