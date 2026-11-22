import { describe, expect, inject, it } from "vitest";
import { ApiError } from "../src/api/client";
import { fetchMbsPrdcSummary, fetchMbsState, fetchTarn } from "../src/api/mbsPrdc";

// Chapter 14: MBS and the PRDC target redemption. The values are rmql's and are reconciled in
// server/tests/reconciliation/mbs_prdc; these tests check the API: normal cases, a request exactly at each limit (it must
// pass; the time is not asserted, since machines differ), a request over it (HTTP 400 with a message in Japanese), and the
// structure and identities of the answers.

const opts = { baseUrl: inject("apiBaseUrl") };

async function status(p: Promise<unknown>): Promise<{ status: number | null; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, message: e.message };
    throw e;
  }
  return { status: 200, message: "" };
}

describe("MBS API (chapters 14.2 and 14.3)", () => {
  it("gives the balance, the prepayment speed and the price along three refinancing paths", async () => {
    const d = await fetchMbsState({}, opts);
    expect(d.months).toHaveLength(360);
    for (const k of ["down", "flat", "up"] as const) {
      const s = d.scenarios[k];
      expect(s.balance[0]).toBeCloseTo(100, 10);
      expect(s.end_balance.at(-1)!).toBeCloseTo(0, 6); // the loan is repaid at the end
      for (let i = 1; i < s.balance.length; i++) expect(s.balance[i]).toBeLessThanOrEqual(s.balance[i - 1] + 1e-12); // the balance never rises
      expect(s.weighted_average_life).toBeGreaterThan(0);
    }
    // lower refinancing rates mean faster prepayment: a shorter life
    expect(d.scenarios.down.weighted_average_life).toBeLessThan(d.scenarios.flat.weighted_average_life);
    expect(d.scenarios.flat.weighted_average_life).toBeLessThan(d.scenarios.up.weighted_average_life);
    expect(d.monte_carlo.prices).toHaveLength(100);
    expect(d.monte_carlo.sample_paths.length).toBeGreaterThanOrEqual(2);
  });

  it("returns the OAS that reprices the assumed price (a higher assumed price gives a lower spread)", async () => {
    const low = await fetchMbsState({ mc: { paths: 40, assumedPrice: 100 } }, opts);
    const high = await fetchMbsState({ mc: { paths: 40, assumedPrice: 110 } }, opts);
    expect(high.monte_carlo.oas_bp).toBeLessThan(low.monte_carlo.oas_bp);
  });

  it("without prepayment (PSA 0) the balance is the level-payment annuity, and nothing is prepaid", async () => {
    const d = await fetchMbsState({ pool: { psaPct: 0 }, mc: { paths: 2 } }, opts);
    expect(Math.max(...d.scenarios.flat.prepaid)).toBe(0);
    const i = 0.05 / 12, n = 360;
    const expected = 100 * (((1 + i) ** n - (1 + i) ** 100) / ((1 + i) ** n - 1));
    expect(d.scenarios.flat.balance[100]).toBeCloseTo(expected, 8);
  });

  it("accepts the limits (200 paths, 360 months) and refuses over them", async () => {
    expect((await fetchMbsState({ mc: { paths: 200 }, pool: { months: 360 } }, opts)).monte_carlo.prices).toHaveLength(200);
    expect((await status(fetchMbsState({ mc: { paths: 202 } }, opts))).status).toBe(400);
    expect((await status(fetchMbsState({ pool: { months: 361 } }, opts))).status).toBe(400);
    const odd = await status(fetchMbsState({ mc: { paths: 101 } }, opts));
    expect(odd.status).toBe(400);
    expect(odd.message).toContain("偶数");
    expect((await status(fetchMbsState({ pool: { mortgageRatePct: 5, passThroughRatePct: 6 } }, opts))).status).toBe(400);
    expect((await status(fetchMbsState({ unknown: 1 } as never, opts))).status).toBe(400);
  });
});

describe("PRDC target redemption API (chapter 14.4)", () => {
  const state = { tarn: { targetPct: 15, makeWhole: true, knockOutLevel: 200 }, mc: { paths: 2000, stepsPerYear: 12, seed: 7 } };

  it("gives the probabilities of the end, a survival that falls from 1, and an expected life within the term", async () => {
    const d = await fetchTarn(state, opts);
    const e = d.endings!;
    expect(e.times).toEqual([1, 2, 3, 4, 5]);
    for (let i = 0; i < e.times.length; i++) {
      expect(e.target_probability[i]).toBeGreaterThanOrEqual(0);
      expect(e.target_probability[i] + e.knock_out_probability[i]).toBeLessThanOrEqual(1);
      if (i) expect(e.alive[i]).toBeLessThanOrEqual(e.alive[i - 1] + 1e-12);
    }
    expect(d.summary.expected_life).toBeGreaterThan(1);
    expect(d.summary.expected_life).toBeLessThanOrEqual(5);
    expect(d.coupon_curve.fx).toHaveLength(21);
  });

  it("is the plain note when the target cannot be reached and the knock-out cannot be hit", async () => {
    const d = await fetchTarn({ tarn: { targetPct: 1000, knockOutLevel: 1e6 }, mc: { paths: 2000, seed: 7 } }, opts);
    expect(d.summary.value).toBeCloseTo(d.summary.plain_value, 9);
    expect(Math.max(...d.endings!.knock_out_probability)).toBe(0);
  });

  it("without a state, the Monte Carlo is within 4 standard errors of the closed form", async () => {
    const d = await fetchTarn({ mc: { paths: 20000, stepsPerYear: 3, seed: 3 } }, opts);
    expect(d.endings).toBeNull();
    expect(Math.abs(d.summary.value - d.summary.analytic)).toBeLessThan(4 * d.summary.standard_error);
  });

  it("accepts exactly the work limit (5,000 paths x 12 steps x 5 years) and refuses over it", async () => {
    expect((await fetchTarn({ ...state, mc: { paths: 5000, stepsPerYear: 12, seed: 7 } }, opts)).summary.value).toBeGreaterThan(0);
    const over = await status(fetchTarn({ ...state, mc: { paths: 5001, stepsPerYear: 12 } }, opts));
    expect(over.status).toBe(400);
    expect(over.message).toContain("300,000");
    expect((await status(fetchTarn({ mc: { paths: 20001, stepsPerYear: 1 } }, opts))).status).toBe(400);
    expect((await status(fetchTarn({ mc: { paths: 199 } }, opts))).status).toBe(400);
    expect((await status(fetchTarn({ tarn: { makeWhole: true } }, opts))).status).toBe(400); // a make-whole needs a target
    expect((await status(fetchTarn({ note: { years: 11 } }, opts))).status).toBe(400);
  });
});

describe("precomputed results (chapters 14.3 and 14.4)", () => {
  it("returns the OAS convergence and the TARN distribution, each with its rmql version and date", async () => {
    const d = await fetchMbsPrdcSummary(opts);
    for (const key of ["mbs_oas_convergence", "prdc_tarn_distribution"] as const) {
      expect(d[key].meta.rmql_version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(d[key].meta.generated).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
    // the spread of the OAS over seeds falls with the number of paths
    const sd = d.mbs_oas_convergence.rows.filter((r) => r.sd_oas_bp !== null).map((r) => r.sd_oas_bp!);
    expect(sd[0]).toBeGreaterThan(sd.at(-1)!);
    const t = d.prdc_tarn_distribution;
    expect(t.convergence.at(-1)!.standard_error).toBeLessThan(t.convergence[0].standard_error);
    // a lower target ends earlier
    for (let i = 1; i < t.by_target.length; i++) expect(t.by_target[i].expected_life).toBeGreaterThanOrEqual(t.by_target[i - 1].expected_life - 1e-9);
  });
});
