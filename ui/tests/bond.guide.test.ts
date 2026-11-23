import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";
import { fetchBond } from "../src/api/bond";

// The numbers in the usage guide of chapter II-1 ("この章の使い方" in ui/src/content/deterministic-cashflow.mdx)
// against what the API returns for the same inputs, and the manuscript's example against the golden values
// (server/tests/golden/bond_golden.json). If the model or the guide changes, one of these fails.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mdx = readFileSync(path.join(root, "src", "content", "deterministic-cashflow.mdx"), "utf8");
const start = mdx.indexOf("<UsageGuide");
const guide = mdx.slice(start, mdx.indexOf("\n/>", start) + 3); // the block ends at a line with only "/>" (steps contain "</>")
const golden = JSON.parse(readFileSync(path.join(root, "..", "server", "tests", "golden", "bond_golden.json"), "utf8")) as {
  clean_price: number; compound_yield_pct: number; risk: { bpv_yen: number; modified_duration: number };
};
const baseUrl = inject("apiBaseUrl");

// the same display rules as the screen: price to 3 decimals, yield and duration truncated to 3 decimals, BPV (sen/bp) to 4
const trunc3 = (x: number) => (Math.trunc(x * 1000) / 1000).toFixed(3);
const shown = (b: Awaited<ReturnType<typeof fetchBond>>["bond"]) => ({
  price: b.clean_price.toFixed(3),
  yield: `${trunc3(b.compound_yield_pct)}%`,
  bpv: `${b.risk.bpv_sen.toFixed(4)} 銭／bp`,
  duration: trunc3(b.risk.modified_duration),
});

describe("Chapter II-1 usage guide", () => {
  it("has the guide block", () => {
    expect(guide.startsWith("<UsageGuide")).toBe(true);
    expect(guide).toContain("6.515");
  });

  it("the initial values in the guide are the manuscript's example (golden) and what the API returns", async () => {
    const b = (await fetchBond({}, { baseUrl })).bond;
    expect(b.simple_yield_pct).toBe(6.515);
    const s = shown(b);
    // the manuscript's example (R chunks run with GaussQuant)
    expect(s.price).toBe(golden.clean_price.toFixed(3));
    expect(s.yield).toBe(`${trunc3(golden.compound_yield_pct)}%`);
    expect(s.bpv).toBe(`${(golden.risk.bpv_yen * 100).toFixed(4)} 銭／bp`);
    expect(s.duration).toBe(trunc3(golden.risk.modified_duration));
    // and the text of the guide
    for (const v of [s.price, s.yield, s.bpv.replace(" 銭／bp", ""), s.duration]) expect(guide, v).toContain(v);
  });

  it("the values after changing the simple yield to 7.0 in the guide are what the API returns", async () => {
    const b = (await fetchBond({ bond: { simpleYieldPct: 7 } }, { baseUrl })).bond;
    const s = shown(b);
    expect(guide).toContain("を 7.0 に変える");
    for (const v of [s.price, s.yield.replace("%", ""), s.bpv.replace(" 銭／bp", "")]) expect(guide, v).toContain(v);
    // the order the guide describes: price -> compound yield -> BPV; the price falls and the yield rises
    const base = (await fetchBond({}, { baseUrl })).bond;
    expect(b.clean_price).toBeLessThan(base.clean_price);
    expect(b.compound_yield_pct).toBeGreaterThan(base.compound_yield_pct);
    expect(b.risk.bpv_sen).toBeLessThan(base.risk.bpv_sen);
  });

  it("the input ranges in the guide's section match the screen's input limits", () => {
    expect(mdx).toContain("**単利利回り（%）**：0.1〜15");
    expect(mdx).toContain("**クーポン（%）**：0〜15");
    expect(mdx).toContain("**Zスプレッド（bp）**：−500〜1000");
    const src = readFileSync(path.join(root, "src", "components", "bond", "index.tsx"), "utf8");
    expect(src).toContain('{ key: "simpleYieldPct", label: "単利利回り（%）", step: 0.005, min: 0.1, max: 15 }');
    expect(src).toContain('{ key: "couponPct", label: "クーポン（%）", step: 0.1, min: 0, max: 15 }');
    expect(src).toContain('{ key: "zSpreadBp", label: "Zスプレッド（bp）", step: 5, min: -500, max: 1000 }');
  });
});
