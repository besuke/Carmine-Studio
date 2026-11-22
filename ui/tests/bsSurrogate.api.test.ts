import { describe, expect, inject, it } from "vitest";
import { ApiError } from "../src/api/client";
import { fetchBsSummary, fetchBsSurrogate } from "../src/api/bsSurrogate";

// Chapter 11.5: a network that learned the Black-Scholes call price. The network is an approximation, so these tests check what the
// page promises: the error inside the training range is small, a request outside it is answered with a warning (not refused), the
// price is homogeneous in (S, K), the derivative is the backward pass, and the saved results are consistent with the live ones.

const opts = { baseUrl: inject("apiBaseUrl") };

async function status(p: Promise<unknown>): Promise<number | null> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
  return 200;
}

describe("learned Black-Scholes price (chapter 11.5)", () => {
  it("is close to the closed form inside the training range, with no warning", async () => {
    const d = await fetchBsSurrogate({}, opts);
    expect(d.warnings).toHaveLength(0);
    expect(Object.values(d.in_range).every(Boolean)).toBe(true);
    expect(Math.abs(d.error.price)).toBeLessThan(1); // K = 100: a price of about 10.8; the largest error inside the range at training was 2.3 (23 bp of K)
    expect(Math.abs(d.error.delta)).toBeLessThan(0.3); // the largest delta error inside the range at training was 0.30
    expect(d.exact.price).toBeCloseTo(10.8, 0);
  });

  it("is homogeneous in (S, K): scaling both scales the network's price and leaves the delta unchanged", async () => {
    const a = await fetchBsSurrogate({ spot: 100, strike: 110 }, opts);
    const b = await fetchBsSurrogate({ spot: 200, strike: 220 }, opts);
    expect(b.network.price).toBeCloseTo(2 * a.network.price, 9);
    expect(b.network.delta).toBeCloseTo(a.network.delta, 10);
  });

  it("answers outside the training range, with a warning that names the input", async () => {
    const far = await fetchBsSurrogate({ spot: 300, strike: 100 }, opts); // ln(S/K) = 1.1
    expect(far.in_range.log_moneyness).toBe(false);
    expect(far.warnings.some((w) => w.includes("ln(S/K)"))).toBe(true);
    const long = await fetchBsSurrogate({ time: 5 }, opts);
    expect(long.in_range.time).toBe(false);
    expect(long.warnings.some((w) => w.includes("満期"))).toBe(true);
    // the error is larger outside the range than inside
    const inside = await fetchBsSurrogate({ spot: 105 }, opts);
    expect(Math.abs(far.error.price) / far.exact.price).toBeGreaterThan(Math.abs(inside.error.price) / inside.exact.price);
  });

  it("refuses inputs that make no sense (HTTP 400) but not ones merely outside the training range", async () => {
    expect(await status(fetchBsSurrogate({ volatilityPct: 0 }, opts))).toBe(400);
    expect(await status(fetchBsSurrogate({ time: 0 }, opts))).toBe(400);
    expect(await status(fetchBsSurrogate({ strike: -1 }, opts))).toBe(400);
    expect(await status(fetchBsSurrogate({ unknown: 1 } as never, opts))).toBe(400);
    expect(await status(fetchBsSurrogate({ volatilityPct: 150, time: 20 }, opts))).toBe(200);
  });

  it("returns the saved results: a passed gradient check, a falling learning curve, errors larger outside the range", async () => {
    const d = await fetchBsSummary(opts);
    expect(Math.max(...Object.values(d.gradient_check))).toBeLessThan(1e-6);
    expect(d.learning_curve.at(-1)!.train_mse).toBeLessThan(d.learning_curve[0].train_mse);
    const inRange = d.errors.find((e) => e.set === "in_range")!;
    for (const e of d.errors.filter((e) => e.set !== "in_range")) expect(e.price_rmse).toBeGreaterThan(inRange.price_rmse);
    // the derivative is less accurate than the price: its error is larger in relation to its size
    expect(inRange.delta_rmse).toBeGreaterThan(inRange.price_rmse);
    expect(d.curves.log_moneyness.grid).toHaveLength(81);
    expect(d.meta.rmql_version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
