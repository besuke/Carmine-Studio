import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";

// Chapter 15's three-factor PRDC without a call: the APIs behind the correlation sensitivities, the cross-gammas, the Vanna and the scenario
//   POST /api/prdc-three-factor            the value, the Greeks, the tables (automatic differentiation and finite differences)
//   POST /api/prdc-three-factor/scan       the graphs: the value and the delta against the inputs, with the tangents
//   POST /api/prdc-three-factor/scenario   one move of the spot, the volatility and the two curves
//   POST /api/prdc-three-factor/scenario-curve   the scenario over the spot change (the line to drag)
//   POST /api/prdc-three-factor/heatmap    the scenario over a coarse grid
//   POST /api/cross-term-example           the unhedged foreign bond
// The second derivatives are rmql's ten (second_order = "full"); the scenario has the second-order expansion besides the first order and the cross terms.
// The tolerances come from the study of the bump widths (server/tests/reconciliation/prdc_three_factor/RECONCILIATION_PRDC_THREE_FACTOR.md).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(readFileSync(path.join(root, "..", "server", "tests", "golden", "prdc_three_factor_golden.json"), "utf8")) as {
  npv: number; greeks: { fx_delta: number; fx_vega: number; domestic_dv01: number; foreign_dv01: number };
  correlation: { pair: string; automatic_differentiation: number; finite_difference: number }[];
  second_order: { item: string; automatic_differentiation: number; finite_difference: number }[];
  scan_slopes: { correlation: number[]; cross_gamma: number[]; vanna: number[] };
  scenario: { pnl: Record<string, number>; contribution: number[] };
  curve_at_5: { full: number; first_order: number; first_plus_cross: number; cross: number[] };
  bubble_scale: number;
};
const baseUrl = inject("apiBaseUrl");

const TOL = {
  correlationFd: 1e-6, // finite difference against automatic differentiation, relative (the page's width 1e-3 gives at most 1.2e-7)
  secondOrderFd: 2e-6, // four-point difference against second-order automatic differentiation, relative (the page's widths give at most 2.4e-7)
  regression: 1e-9, // the closed form against the golden values, relative
  same: 1e-12, // the same computation reached through two APIs, relative
  tangentGrid: 2e-3, // the slope of the tangent against the plotted delta at +-20 bp (the curvature of the delta)
};
const ZERO = { spotYen: 0, volPoints: 0, domesticBp: 0, foreignBp: 0 };
const SHOCK = { spotYen: 5, volPoints: 2, domesticBp: 20, foreignBp: -20 };

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (endpoint: string, body: unknown = {}): Promise<{ status: number; json: Json }> => {
  const res = await fetch(`${baseUrl}/api/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};
const ok = async (endpoint: string, body: unknown = {}): Promise<Json> => {
  const r = await call(endpoint, body);
  expect(r.status, `${endpoint}: ${r.json.error ?? ""}`).toBe(200);
  return r.json;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const same = (a: number, b: number, tol = TOL.same, name = "") => expect(Math.abs(a - b), `${name}: ${a} against ${b}`).toBeLessThanOrEqual(tol * Math.max(Math.abs(b), 1) + 1e-6);
const PNL_KEYS = ["full", "first_order", "first_plus_cross", "second_order", "difference_first_order", "difference_first_plus_cross", "difference_second_order"] as const;

describe("1. zero moves and the spot alone", () => {
  it("every move zero: the profit and loss and every contribution are zero", async () => {
    const s = await ok("prdc-three-factor/scenario", { shock: ZERO });
    for (const k of PNL_KEYS) expect(Math.abs(s.pnl[k]), k).toBeLessThan(1e-6);
    for (const c of s.contribution) expect(Math.abs(c.value), c.item).toBeLessThan(1e-6);
    const curve = await ok("prdc-three-factor/scenario-curve", { shock: ZERO });
    const origin = curve.points.find((p: Json) => p.spotYen === 0);
    for (const k of PNL_KEYS) expect(Math.abs(origin[k]), `curve ${k}`).toBeLessThan(1e-6);
    for (const v of Object.values(origin.cross) as number[]) expect(Math.abs(v)).toBeLessThan(1e-6);
  });

  it("the spot alone: the cross terms are zero, so the first order plus the cross terms is the first order", async () => {
    const only = { ...ZERO, spotYen: 5 };
    const s = await ok("prdc-three-factor/scenario", { shock: only });
    const cross = s.contribution.filter((c: Json) => c.kind === "cross");
    expect(cross.length).toBe(3);
    for (const c of cross) expect(c.value === 0, `${c.item}: ${c.value}`).toBe(true); // -0 counts as zero
    expect(s.pnl.first_plus_cross === s.pnl.first_order, `${s.pnl.first_plus_cross} against ${s.pnl.first_order}`).toBe(true);
    expect(Math.abs(s.pnl.full)).toBeGreaterThan(1e5); // the move itself is not zero
    expect(s.contribution.find((c: Json) => c.short === "デルタ").value).toBeCloseTo(s.pnl.first_order, 6);
    // the other second-order terms need a second move; the gamma of the spot alone remains, so the second order is the first order plus the gamma term
    const rest = s.contribution.filter((c: Json) => c.kind === "second");
    expect(rest.length).toBe(7);
    for (const c of rest) if (c.short === "ガンマ") expect(c.value, c.item).toBeGreaterThan(0); else expect(c.value === 0, `${c.item}: ${c.value}`).toBe(true);
    expect(s.pnl.second_order).toBeCloseTo(s.pnl.first_order + rest.find((c: Json) => c.short === "ガンマ").value, 6);
    const curve = await ok("prdc-three-factor/scenario-curve", { shock: ZERO });
    for (const p of curve.points) {
      for (const v of Object.values(p.cross) as number[]) expect(v === 0, `spot ${p.spotYen}: ${v}`).toBe(true);
      expect(p.first_plus_cross === p.first_order, `spot ${p.spotYen}`).toBe(true);
      if (p.spotYen !== 0) expect(p.second_order, `spot ${p.spotYen}`).toBeGreaterThan(p.first_order); // the gamma is positive
      else expect(p.second_order === p.first_order).toBe(true);
    }
  });

  it("the heat map: the Vanna is zero on the zero-volatility row and on the zero-spot column", async () => {
    const h = await ok("prdc-three-factor/heatmap", { shock: { ...ZERO, domesticBp: 0, foreignBp: 0 } });
    for (const c of h.maps.vol.cells) {
      if (c.y === 0 || c.spotYen === 0) for (const v of Object.values(c.cross) as number[]) expect(v === 0, `spot ${c.spotYen}, vol ${c.y}: ${v}`).toBe(true);
    }
  });
});

describe("2. one scenario against the curve and the heat map", () => {
  it("the same move gives the same three profits and losses and the same cross terms in the point scenario and in the curve", async () => {
    const curve = await ok("prdc-three-factor/scenario-curve", { shock: SHOCK });
    for (const k of [-30, -10, 0, 5, 30]) {
      const s = await ok("prdc-three-factor/scenario", { shock: { ...SHOCK, spotYen: k } });
      const p = curve.points.find((q: Json) => q.spotYen === k);
      for (const key of PNL_KEYS) same(p[key], s.pnl[key], TOL.same, `spot ${k} ${key}`);
      const byShort = (short: string) => s.contribution.find((c: Json) => c.short === short).value;
      same(p.cross.domestic, byShort("Γ×円金利"), TOL.same, `spot ${k} cross domestic`);
      same(p.cross.foreign, byShort("Γ×外貨金利"), TOL.same, `spot ${k} cross foreign`);
      same(p.cross.vanna, byShort("Vanna"), TOL.same, `spot ${k} Vanna`);
    }
    // the bubble scale is the largest cross contribution of the grid
    const largest = Math.max(...curve.points.flatMap((q: Json) => Object.values(q.cross) as number[]).map(Math.abs));
    same(curve.bubble_scale, largest, TOL.same, "bubble scale");
  });

  it("a heat-map cell is the scenario of its move (volatility, and the domestic and foreign rate)", async () => {
    const h = await ok("prdc-three-factor/heatmap", { shock: SHOCK });
    const cases: [string, Json, Json][] = [
      ["vol", { spotYen: 10, y: 4 }, { ...SHOCK, spotYen: 10, volPoints: 4 }],
      ["rate_domestic", { spotYen: -20, y: 50 }, { ...SHOCK, spotYen: -20, domesticBp: 50 }],
      ["rate_foreign", { spotYen: 30, y: -100 }, { ...SHOCK, spotYen: 30, foreignBp: -100 }],
    ];
    for (const [map, at, shock] of cases) {
      const cell = h.maps[map].cells.find((c: Json) => c.spotYen === at.spotYen && c.y === at.y);
      const s = await ok("prdc-three-factor/scenario", { shock });
      for (const key of PNL_KEYS) same(cell[key], s.pnl[key], TOL.same, `${map} ${key}`);
      same(cell.cross.vanna, s.contribution[6].value, TOL.same, `${map} Vanna`);
    }
  });
});

describe("3. the slopes of the tangents are the values of the sensitivity table, in the same unit", () => {
  it("correlations, cross-gammas and Vanna", async () => {
    const main = await ok("prdc-three-factor");
    const scan = await ok("prdc-three-factor/scan");
    // per +0.01 of a correlation
    scan.correlation.forEach((c: Json, i: number) => same(c.slope * 0.01, main.correlation[i].automatic_differentiation, TOL.same, `correlation ${c.pair}`));
    // per (FX 1 yen x 1 bp) and per (FX 1 yen x 1 volatility point)
    same(scan.cross_gamma.domestic.slope_per_bp, main.second_order[0].automatic_differentiation, TOL.same, "cross-gamma domestic");
    same(scan.cross_gamma.foreign.slope_per_bp, main.second_order[1].automatic_differentiation, TOL.same, "cross-gamma foreign");
    same(scan.vanna.delta_by_vol.slope_per_point, main.second_order[2].automatic_differentiation, TOL.same, "Vanna (delta by volatility)");
    same(scan.vanna.vega_by_spot.slope_per_yen, main.second_order[2].automatic_differentiation, TOL.same, "Vanna (vega by spot)");
    expect(main.second_order[0].unit).toBe("円／（FX 1円 × 1bp）");
    expect(main.second_order[2].unit).toBe("円／（FX 1円 × ボラ 1%）");
  });

  it("a tangent goes through the value of its point and has that slope", async () => {
    const main = await ok("prdc-three-factor");
    const scan = await ok("prdc-three-factor/scan");
    for (const c of scan.correlation) {
      const at = c.points.find((p: Json) => Math.abs(p.rho - c.current) < 1e-9);
      if (at) same(at.tangent, main.npv, TOL.same, `tangent of ${c.pair} at the current correlation`);
      const [a, b] = [c.points[0], c.points[1]];
      same((b.tangent - a.tangent) / (b.rho - a.rho), c.slope, 1e-9, `slope of ${c.pair}`);
    }
    for (const side of ["domestic", "foreign"]) {
      const g = scan.cross_gamma[side];
      const zero = g.points.find((p: Json) => p.shift_bp === 0);
      same(zero.tangent, main.greeks.fx_delta, TOL.same, `${side}: the tangent at no shift is the delta`);
      same(zero.delta, main.greeks.fx_delta, TOL.same, `${side}: the delta at no shift`);
      // the plotted delta at +-20 bp has the slope of the tangent, up to the curvature of the delta
      const up = g.points.find((p: Json) => p.shift_bp === 20), dn = g.points.find((p: Json) => p.shift_bp === -20);
      expect(rel((up.delta - dn.delta) / 40, g.slope_per_bp), `${side} slope against the plotted delta`).toBeLessThan(TOL.tangentGrid);
    }
    const v = scan.vanna;
    same(v.delta_by_vol.points.find((p: Json) => p.vol_pct === 12).tangent, main.greeks.fx_delta, TOL.same, "the delta at 12% volatility");
    same(v.vega_by_spot.points.find((p: Json) => p.spot === 150).tangent, main.greeks.fx_vega * 0.01, TOL.same, "the vega at the spot of 150");
  });
});

describe("4. automatic differentiation against finite differences, at the widths of the page", () => {
  it("the correlations and the ten second derivatives", async () => {
    const main = await ok("prdc-three-factor");
    expect(main.second_order.length).toBe(10);
    expect(main.second_order.map((r: Json) => r.item.split("：")[0])).toEqual(["クロスガンマ", "クロスガンマ", "Vanna", "ガンマ", "ボルガ", "円金利の2階（コンベクシティ）", "外貨金利の2階", "円金利 × 外貨金利", "円金利 × FXボラティリティ", "外貨金利 × FXボラティリティ"]);
    for (const c of main.correlation) expect(rel(c.finite_difference, c.automatic_differentiation), c.pair).toBeLessThan(TOL.correlationFd);
    for (const r of main.second_order) expect(rel(r.finite_difference, r.automatic_differentiation), r.item).toBeLessThan(TOL.secondOrderFd);
  });
});

describe("5. the page's numbers against the golden values", () => {
  it("the value, the Greeks, the sensitivities, the scenario and the curve", async () => {
    const main = await ok("prdc-three-factor");
    const scan = await ok("prdc-three-factor/scan");
    const s = await ok("prdc-three-factor/scenario");
    const curve = await ok("prdc-three-factor/scenario-curve");
    same(main.npv, golden.npv, TOL.regression, "npv");
    for (const k of ["fx_delta", "fx_vega", "domestic_dv01", "foreign_dv01"] as const) same(main.greeks[k], golden.greeks[k], TOL.regression, k);
    main.correlation.forEach((c: Json, i: number) => same(c.automatic_differentiation, golden.correlation[i].automatic_differentiation, TOL.regression, c.pair));
    main.second_order.forEach((r: Json, i: number) => same(r.automatic_differentiation, golden.second_order[i].automatic_differentiation, TOL.regression, r.item));
    scan.correlation.forEach((c: Json, i: number) => same(c.slope, golden.scan_slopes.correlation[i], TOL.regression, `slope ${i}`));
    same(scan.cross_gamma.domestic.slope_per_bp, golden.scan_slopes.cross_gamma[0], TOL.regression, "cross-gamma domestic");
    same(scan.vanna.vega_by_spot.slope_per_yen, golden.scan_slopes.vanna[1], TOL.regression, "Vanna");
    for (const k of PNL_KEYS) same(s.pnl[k], golden.scenario.pnl[k], TOL.regression, `scenario ${k}`);
    s.contribution.forEach((c: Json, i: number) => same(c.value, golden.scenario.contribution[i], TOL.regression, c.item));
    const at5 = curve.points.find((p: Json) => p.spotYen === 5);
    same(at5.full, golden.curve_at_5.full, TOL.regression, "curve full");
    same(at5.first_plus_cross, golden.curve_at_5.first_plus_cross, TOL.regression, "curve first plus cross");
    same(curve.bubble_scale, golden.bubble_scale, TOL.regression, "bubble scale");
  });

  it("the example of the cross term: an unhedged foreign bond", async () => {
    const e = await ok("cross-term-example");
    expect(e.steps.map((r: Json) => r.item)).toEqual(["債券", "為替", "交差項"]);
    expect(e.steps[0].value_pt).toBe(-2);
    expect(e.steps[1].value_pt).toBe(5);
    expect(e.steps[2].value_pt).toBeCloseTo(-0.1, 12);
    expect(e.total_pct).toBeCloseTo(2.9, 12);
    // the total is the sum of the three steps, for any inputs; none of them moves: zero
    const x = await ok("cross-term-example", { bondPct: 7.5, fxPct: -12 });
    expect(x.total_pct).toBeCloseTo(x.steps.reduce((a: number, r: Json) => a + r.value_pt, 0), 12);
    const z = await ok("cross-term-example", { bondPct: 0, fxPct: 0 });
    expect(z.total_pct).toBe(0);
  });
});

describe("7. the second-order expansion", () => {
  it("the contributions add up to the first order (4), the first order plus the cross terms (7) and the second order (14)", async () => {
    const s = await ok("prdc-three-factor/scenario");
    const c = s.contribution as Json[];
    expect(c.length).toBe(14);
    expect(c.map((r) => r.kind)).toEqual(["first", "first", "first", "first", "cross", "cross", "cross", ...Array(7).fill("second")]);
    const sum = (a: number, b: number) => c.slice(a, b).reduce((x, r) => x + r.value, 0);
    same(sum(0, 4), s.pnl.first_order, TOL.same, "first order");
    same(sum(0, 7), s.pnl.first_plus_cross, TOL.same, "first plus cross");
    same(sum(0, 14), s.pnl.second_order, TOL.same, "second order");
    same(s.pnl.full - s.pnl.second_order, s.pnl.difference_second_order, TOL.same, "what the second order leaves");
  });

  it("each step is closer to the full revaluation: first order, plus the cross terms, second order (the default move)", async () => {
    const s = await ok("prdc-three-factor/scenario");
    const d = [s.pnl.difference_first_order, s.pnl.difference_first_plus_cross, s.pnl.difference_second_order].map(Math.abs);
    expect(d[1], `${d}`).toBeLessThan(d[0]);
    expect(d[2], `${d}`).toBeLessThan(d[1]);
    expect(d[2]).toBeLessThan(0.05 * Math.abs(s.pnl.full)); // the second order is within 5% of the full revaluation here
  });

  it("the first order leaves a second-order error (it falls by about 4 when the move is halved) and the second order a third-order error (about 8 for small moves)", async () => {
    const at = async (k: number) => (await ok("prdc-three-factor/scenario", { shock: { spotYen: 4 * k, volPoints: 2 * k, domesticBp: 20 * k, foreignBp: -20 * k } })).pnl;
    const [a, b, c, d] = [await at(0.25), await at(0.125), await at(0.0625), await at(0.03125)];
    expect(Math.abs(a.difference_first_order / b.difference_first_order), "first order").toBeGreaterThan(3.5);
    expect(Math.abs(a.difference_first_order / b.difference_first_order), "first order").toBeLessThan(4.5);
    // the second-order error is of third order in the move: the ratio comes to 8 as the move gets smaller
    const ratio = (x: Json, y: Json) => Math.abs(x.difference_second_order / y.difference_second_order);
    expect(ratio(b, c), "second order, 0.125 to 0.0625").toBeGreaterThan(7);
    expect(ratio(b, c)).toBeLessThan(8.5);
    expect(ratio(c, d), "second order, 0.0625 to 0.03125").toBeGreaterThan(7.3);
    expect(ratio(c, d)).toBeLessThan(8.3);
  });
});

describe("6. bad inputs are refused with a message", () => {
  it("correlations, moves and unknown fields", async () => {
    for (const endpoint of ["prdc-three-factor", "prdc-three-factor/scan", "prdc-three-factor/scenario", "prdc-three-factor/scenario-curve", "prdc-three-factor/heatmap"]) {
      const range = await call(endpoint, { correlation: { domesticFx: 1.5 } });
      expect(range.status, `${endpoint} range`).toBe(400);
      expect(range.json.error).toContain("-0.99〜0.99");
      const notMatrix = await call(endpoint, { correlation: { domesticForeign: 0.9, domesticFx: 0.9, foreignFx: -0.9 } });
      expect(notMatrix.status, `${endpoint} matrix`).toBe(400);
      expect(notMatrix.json.error).toContain("相関行列");
      expect((await call(endpoint, { unknown: 1 })).status, `${endpoint} unknown`).toBe(400);
    }
    for (const endpoint of ["prdc-three-factor/scenario", "prdc-three-factor/scenario-curve", "prdc-three-factor/heatmap"]) {
      const spot = await call(endpoint, { shock: { spotYen: 99 } });
      expect(spot.status, `${endpoint} shock`).toBe(400);
      expect(spot.json.error).toContain("shock.spotYen");
      expect((await call(endpoint, { shock: { rate: 1 } })).status, `${endpoint} unknown shock`).toBe(400);
    }
    expect((await call("cross-term-example", { bondPct: 99 })).status).toBe(400);
  });
});
