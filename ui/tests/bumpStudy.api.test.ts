import { describe, expect, inject, it } from "vitest";

// POST /api/prdc-three-factor/bump-study: the finite difference against the bump width. Automatic differentiation has no width, so its
// value is the reference. Checks: the page's width (x1) is accurate, the error grows for large widths (truncation) and for the smallest
// widths of the second derivatives (round-off), and the reference equals the value of the main endpoint.

const baseUrl = inject("apiBaseUrl");
const post = async (path: string, body: unknown) => {
  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};

describe("bump-width study", () => {
  it("the page's width is accurate and the error grows with the width", async () => {
    const { status, json } = await post("/api/prdc-three-factor/bump-study", {});
    expect(status).toBe(200);
    expect(json.studies.map((s: any) => s.key)).toEqual(["rho", "gamma", "vanna", "rate2", "rate_vol"]);
    for (const s of json.studies) {
      const at = (m: number) => s.points.find((p: any) => Math.abs(p.multiplier - m) < 1e-9);
      expect(at(1).relative_error, s.key).toBeLessThan(2e-6); // the same tolerance as the page's table
      const largest = s.points[s.points.length - 1];
      expect(largest.relative_error, s.key).toBeGreaterThan(at(1).relative_error * 100); // truncation error at the widest
      expect(Math.min(...s.points.map((p: any) => p.relative_error)), s.key).toBeLessThan(1e-6);
    }
    // round-off on the small side: the second derivatives of one variable
    for (const k of ["gamma", "rate2"]) {
      const s = json.studies.find((x: any) => x.key === k);
      expect(s.points[0].relative_error, k).toBeGreaterThan(s.points.find((p: any) => p.multiplier === 1).relative_error * 100);
    }
  });

  it("the reference is the main endpoint's automatic-differentiation value", async () => {
    const study = (await post("/api/prdc-three-factor/bump-study", { correlation: { domesticFx: 0.1 } })).json;
    const main = (await post("/api/prdc-three-factor", { correlation: { domesticFx: 0.1 } })).json;
    const rho = study.studies.find((s: any) => s.key === "rho").automatic_differentiation;
    expect(rho * 0.01).toBeCloseTo(main.correlation[1].automatic_differentiation, 6);
  });

  it("a bad correlation is a 400, an unknown field too", async () => {
    expect((await post("/api/prdc-three-factor/bump-study", { correlation: { domesticFx: 2 } })).status).toBe(400);
    expect((await post("/api/prdc-three-factor/bump-study", { foo: 1 })).status).toBe(400);
  });
});

describe("cost of the ten second derivatives", () => {
  it("counts the valuations and measures the time", async () => {
    const { status, json } = await post("/api/prdc-three-factor/derivative-cost", {});
    expect(status).toBe(200);
    expect(json.items).toHaveLength(10);
    expect(json.automatic_differentiation.valuations).toBe(1);
    expect(json.finite_difference.valuations).toBe(1 + 4 * 2 + 6 * 4); // base, four same-variable (3 points), six crosses (4 points)
    expect(json.automatic_differentiation.milliseconds).toBeGreaterThan(0);
    expect(json.finite_difference.milliseconds).toBeGreaterThan(json.automatic_differentiation.milliseconds * 3); // the wall clock is noisy: a loose bound
  }, 120000);
});
