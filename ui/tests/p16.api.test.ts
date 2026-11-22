import { describe, expect, inject, it } from "vitest";
import { ApiError } from "../src/api/client";
import { fetchConvertible, fetchLookback, fetchMscb, fetchP16Summary } from "../src/api/p16";

// Chapter 13: lookback options, convertible bonds and MSCB. The values are rmql's and are reconciled in
// server/tests/reconciliation/p16; these tests check the API: normal cases, a request exactly at each limit (it must pass),
// a request over it (HTTP 400 with a message in Japanese), and the structure and identities of the answers.

const baseUrl = inject("apiBaseUrl");
const opts = { baseUrl };

async function status(p: Promise<unknown>): Promise<{ status: number | null; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, message: e.message };
    throw e;
  }
  return { status: 200, message: "" };
}

describe("lookback option API (chapter 13.2)", () => {
  it("gives the continuous and the discretely monitored value, and the Greeks", async () => {
    const d = await fetchLookback({}, opts);
    expect(d.continuous.value).toBeGreaterThan(0);
    expect(d.discrete!.value).toBeGreaterThan(0);
    expect(d.discrete!.value).toBeLessThan(d.continuous.value); // fewer monitoring dates, a smaller extremum
    expect(d.monitoring_times).toHaveLength(12);
    expect(d.continuous.delta).toBeCloseTo(d.continuous.value / d.inputs.spot, 10); // a floating call with the extremum at the money is homogeneous of degree 1 in S
  });

  it("is a floating put plus a constant for a fixed call (the identity of 13.2)", async () => {
    const fixed = await fetchLookback({ lookbackType: "fixed", optionType: "call", strike: 90, monitoringCount: 0 }, opts);
    const floating = await fetchLookback({ lookbackType: "floating", optionType: "put", monitoringCount: 0 }, opts);
    const expected = floating.continuous.value + 100 * Math.exp(-0.01) - 90 * Math.exp(-0.03);
    expect(fixed.continuous.value).toBeCloseTo(expected, 10);
    expect(fixed.discrete).toBeNull();
  });

  it("accepts the largest number of steps and refuses one more", async () => {
    expect((await fetchLookback({ steps: 400, monitoringCount: 400 }, opts)).discrete!.value).toBeGreaterThan(0);
    const over = await status(fetchLookback({ steps: 401 }, opts));
    expect(over.status).toBe(400);
    expect(over.message).toContain("段数");
  });

  it("refuses inputs that cannot be priced", async () => {
    expect((await status(fetchLookback({ lookbackType: "fixed" }, opts))).status).toBe(400); // no strike
    expect((await status(fetchLookback({ runningExtremum: 120 }, opts))).status).toBe(400); // a minimum above the spot
    expect((await status(fetchLookback({ monitoringCount: 500 }, opts))).status).toBe(400);
    expect((await status(fetchLookback({ volatilityPct: 0 }, opts))).status).toBe(400);
    expect((await status(fetchLookback({ unknownField: 1 } as never, opts))).status).toBe(400);
  });
});

describe("convertible bond API (chapters 13.3 and 13.4)", () => {
  it("values a fixed-ratio convertible above its conversion value and above the straight bond", async () => {
    const d = await fetchConvertible({}, opts);
    expect(d.values.value).toBeGreaterThan(100); // spot 100, ratio 1: conversion value 100
    expect(d.values.delta).toBeGreaterThan(0);
    expect(d.values.delta).toBeLessThanOrEqual(1);
    expect(d.conversion_value.values.at(-1)! > d.conversion_value.values[0]).toBe(true);
    expect(d.immediate_conversion).toBe(false);
  });

  it("a call lowers the value; a put raises it", async () => {
    const plain = (await fetchConvertible({}, opts)).values.value;
    const call = (await fetchConvertible({ callabilities: [{ years: 3, kind: "call", price: 108 }] }, opts)).values.value;
    const put = (await fetchConvertible({ callabilities: [{ years: 3, kind: "put", price: 108 }] }, opts)).values.value;
    expect(call).toBeLessThan(plain);
    expect(put).toBeGreaterThan(plain);
  });

  it("converts at once for face / ratio above lower / ratio when the conversion price is reset", async () => {
    const d = await fetchConvertible({ conversion: { kind: "reset", priceRatio: 0.9, lowerPrice: 80 }, market: { spot: 100 }, steps: 200 }, opts);
    expect(d.immediate_conversion).toBe(true);
    expect(d.values.value).toBeCloseTo(100 / 0.9, 8);
  });

  it("accepts exactly the limits: 300 steps, 10 calls and puts", async () => {
    const calls = Array.from({ length: 10 }, (_, i) => ({ years: 0.5 * (i + 1) + 0.5, kind: (i % 2 ? "put" : "call") as "call" | "put", price: 100 + i }));
    const d = await fetchConvertible({ bond: { remainingYears: 10 }, steps: 300, callabilities: calls }, opts);
    expect(d.values.value).toBeGreaterThan(0);
  });

  it("refuses 301 steps, 11 calls, a soft call with a reset price, and a year that is not a multiple of 0.5", async () => {
    expect((await status(fetchConvertible({ steps: 301 }, opts))).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ years: 0.5 * (i + 1), kind: "call" as const, price: 105 }));
    const tooMany = await status(fetchConvertible({ bond: { remainingYears: 10 }, callabilities: eleven }, opts));
    expect(tooMany.status).toBe(400);
    expect(tooMany.message).toContain("10");
    const soft = await status(fetchConvertible({ conversion: { kind: "reset", priceRatio: 0.9, lowerPrice: 80 }, callabilities: [{ years: 3, kind: "call", price: 108, trigger: 130 }] }, opts));
    expect(soft.status).toBe(400);
    expect((await status(fetchConvertible({ callabilities: [{ years: 3.2, kind: "call", price: 108 }] }, opts))).status).toBe(400);
  });
});

describe("MSCB API (chapter 13.5)", () => {
  const down = { conversion: { initialPrice: 100, priceRatio: 0.9 }, resetYears: [1, 2, 3, 4], market: { spot: 85 } };

  it("prices the scaled lattice with Greeks and gives the conversion price along a scenario", async () => {
    const d = await fetchMscb({ ...down, scenario: "down" }, opts);
    expect(d.values.value).toBeGreaterThan(0);
    expect(d.scenario!.conversion_price).toHaveLength(4);
    // downward only: the conversion price never rises
    const k = d.scenario!.conversion_price;
    for (let i = 1; i < k.length; i++) expect(k[i]).toBeLessThanOrEqual(k[i - 1] + 1e-12);
    expect(k[0]).toBeLessThanOrEqual(100);
  });

  it("is worth more with downward resets than a fixed ratio when the share price is low", async () => {
    const reset = (await fetchMscb(down, opts)).values.value;
    const fixed = (await fetchConvertible({ conversion: { kind: "fixed", ratio: 1 }, market: { spot: 85 } }, opts)).values.value;
    expect(reset).toBeGreaterThanOrEqual(fixed - 1e-9);
  });

  it("accepts the limits: 400 steps and 12 resets in the scaled lattice; 80 prices x 400 steps in the grid without Greeks", async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => 0.5 * (i + 1));
    expect((await fetchMscb({ ...down, bond: { remainingYears: 10 }, resetYears: twelve, steps: 400 }, opts)).values.value).toBeGreaterThan(0);
    const g = await fetchMscb({ ...down, method: "grid", greeks: false, priceNodes: 80, steps: 400 }, opts);
    expect(g.values.value).toBeGreaterThan(0);
  });

  it("refuses the grid with Greeks, 13 resets, 401 steps, and a grid over the work limit", async () => {
    const grid = await status(fetchMscb({ ...down, method: "grid", greeks: true }, opts));
    expect(grid.status).toBe(400);
    expect(grid.message).toContain("グリークス");
    const thirteen = Array.from({ length: 13 }, (_, i) => 0.5 * (i + 1));
    expect((await status(fetchMscb({ ...down, bond: { remainingYears: 10 }, resetYears: thirteen }, opts))).status).toBe(400);
    expect((await status(fetchMscb({ ...down, steps: 401 }, opts))).status).toBe(400);
    const work = await status(fetchMscb({ ...down, method: "grid", greeks: false, priceNodes: 80, steps: 401 }, opts));
    expect(work.status).toBe(400);
    expect((await status(fetchMscb({ ...down, method: "grid", greeks: false, priceNodes: 81 }, opts))).status).toBe(400);
  });

  it("refuses price limits in the scaled lattice, which cannot hold them", async () => {
    const r = await status(fetchMscb({ ...down, conversion: { initialPrice: 100, priceRatio: 0.9, lowerPrice: 70 } }, opts));
    expect(r.status).toBe(400);
    expect(r.message).toContain("grid");
  });
});

describe("precomputed results (chapters 13.2 to 13.5)", () => {
  it("returns the four saved tables, each with its rmql version, date and seed", async () => {
    const d = await fetchP16Summary(opts);
    for (const key of ["lookback_convergence", "convertible_curve", "mscb_reset_closed_form", "mscb_carried_grid"] as const) {
      expect(d[key].meta.rmql_version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(d[key].meta.generated).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
    expect(d.lookback_convergence.meta.seed).toBe(20261122);
    // the error of the discretely monitored tree falls as 1 / sqrt(steps)
    const call = d.lookback_convergence.every_step.call;
    const scaled = call.error.map((e, i) => e * Math.sqrt(call.steps[i]));
    expect(Math.max(...scaled) - Math.min(...scaled)).toBeLessThan(0.05 * Math.max(...scaled));
    // the closed form of the European reset is met at 2000 steps
    for (const row of d.mscb_reset_closed_form.closed_form_table) expect(Math.abs(row.relative_error.at(-1)!)).toBeLessThan(1e-4);
    // the convertible lies above both the straight bond and the conversion value
    const c = d.convertible_curve;
    c.spots.forEach((_, i) => {
      expect(c.convertible.value[i]).toBeGreaterThanOrEqual(c.conversion_value[i] - 1e-9);
      expect(c.convertible.value[i]).toBeGreaterThanOrEqual(c.straight_bond[i] - 1e-6);
    });
  });
});
