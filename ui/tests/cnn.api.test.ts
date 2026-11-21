import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";
import { fetchCnnForecast, fetchCnnSummary } from "../src/api/cnn";

// Chapter 11.4: the 1D-CNN experiment's API. The saved results are the offline script's
// (server/scripts/cnn/train_jgb_1d_cnn.R); the bond is valued by rmql on four curves. The checks are of structure and
// consistency, not of the forecasts' quality.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const saved = JSON.parse(readFileSync(path.join(root, "..", "server", "data", "cnn", "jgb_1d_cnn_results.json"), "utf8")) as {
  predictions: { origin: string; target_month: string; actual: number[]; ridge: number[]; cnn: number[] }[];
  gradient_check: Record<string, number>;
};
const baseUrl = inject("apiBaseUrl");

describe("1D-CNN experiment (chapter 11.4)", () => {
  it("summarizes the saved results: the gradient check, three models, four periods", async () => {
    const d = await fetchCnnSummary({ baseUrl });
    expect(Math.max(...Object.values(d.gradient_check))).toBeLessThan(1e-6);
    expect(d.months.origin.length).toBe(saved.predictions.length);
    expect(d.months.origin[0]).toBe(saved.predictions[0].origin);
    for (const period of ["all", "first_half", "second_half", "since_2022"] as const) {
      const pooled = d.metrics[period].filter((r) => r.tenor === "all");
      expect(pooled.map((r) => r.model).sort()).toEqual(["cnn", "random_walk", "ridge"]);
      for (const r of d.metrics[period]) {
        expect(r.rmse).toBeGreaterThan(0);
        expect(r.mae).toBeLessThanOrEqual(r.rmse + 1e-12); // MAE <= RMSE
      }
    }
    // the kernels: filters x (4 channels x kernel width)
    expect(d.kernels.last.length).toBe(d.settings.filters);
    expect(d.kernels.last[0].length).toBe(4 * d.settings.kernel);
    expect(d.rolling_rmse.cnn.length).toBe(d.months.origin.length);
  });

  it("values the bond on four curves, and the realized scenario is the realized change", async () => {
    const month = saved.predictions[100].origin.slice(0, 7).replace("-", "");
    const d = await fetchCnnForecast({ month, bond: { remainingYears: 10, couponPct: 1, faceAmount: 100 } }, { baseUrl });
    expect(d.valuation.map((v) => v.scenario)).toEqual(["actual", "cnn", "ridge", "random_walk"]);
    const actual = d.valuation[0];
    expect(actual.pnl_error).toBe(0);
    for (const v of d.valuation) {
      expect(v.pnl_error).toBeCloseTo(v.pnl - actual.pnl, 10);
      expect(Number.isFinite(v.npv)).toBe(true);
    }
    // the forecast curves are the chosen month's yields plus the saved forecast changes
    const row = saved.predictions[100];
    d.nodes.tenor.forEach((_, k) => {
      expect(d.nodes.change_bp.cnn[k]).toBeCloseTo(row.cnn[k], 9);
      expect(d.nodes.change_bp.actual[k]).toBeCloseTo(row.actual[k], 9);
      expect(d.nodes.scenario.cnn[k]).toBeCloseTo(d.nodes.current[k] + row.cnn[k] / 100, 9);
      expect(d.nodes.scenario.random_walk[k]).toBe(d.nodes.current[k]);
    });
    // the no-change scenario differs from "now" only by the month that passed
    expect(d.curves.years.length).toBe(d.curves.current.length);
    expect(d.dates.next_month > d.dates.origin).toBe(true);
    expect(d.response.request_id).toBeTruthy();
  });

  it("a higher coupon is worth more, and the face amount scales the value", async () => {
    const month = saved.predictions[50].origin.slice(0, 7).replace("-", "");
    const low = await fetchCnnForecast({ month, bond: { couponPct: 0.5 } }, { baseUrl });
    const high = await fetchCnnForecast({ month, bond: { couponPct: 2 } }, { baseUrl });
    expect(high.current_value.npv).toBeGreaterThan(low.current_value.npv);
    const big = await fetchCnnForecast({ month, bond: { couponPct: 0.5, faceAmount: 1000 } }, { baseUrl });
    expect(big.current_value.npv).toBeCloseTo(10 * low.current_value.npv, 8);
  });

  it("rejects a month outside the forecasts and bond terms out of range", async () => {
    await expect(fetchCnnForecast({ month: "199001" }, { baseUrl })).rejects.toMatchObject({ status: 400 });
    await expect(fetchCnnForecast({ month: "202101", bond: { remainingYears: 1 } }, { baseUrl })).rejects.toMatchObject({ status: 400 });
    await expect(fetchCnnForecast({ month: "202101", bond: { remainingYears: 10.5 } }, { baseUrl })).rejects.toMatchObject({ status: 400 });
    await expect(fetchCnnForecast({ month: "202101", bond: { couponPct: -1 } }, { baseUrl })).rejects.toMatchObject({ status: 400 });
    await expect(fetchCnnForecast({ month: "2021-01" }, { baseUrl })).rejects.toMatchObject({ status: 400 });
  });
});
