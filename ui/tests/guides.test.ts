import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";

// The usage guides ("この章の使い方") of chapters II-2 to II-9 and Part III, checked against what the screen and the API use:
//  1. the initial values written in the guide are the API's default inputs (the manuscript's R examples) or the screen's defaults,
//  2. the input ranges written in the page are the screen's input limits,
//  3. every "へ" button of a guide points at a heading or an id that exists on the same page.
// Chapter II-1 has its own test with the result numbers (bond.guide.test.ts).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = inject("apiBaseUrl");
const read = (...p: string[]) => readFileSync(path.join(root, ...p), "utf8");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

const PAGES: Record<string, string> = {
  "II-2 curves": "yield-curves.mdx", "II-2 futures": "jgb-futures.mdx", "II-3": "yield-curve-ois.mdx", "II-4": "black-model.mdx",
  "II-5": "credit-cds.mdx", "II-6": "irs-calibration.mdx", "II-7": "rate-models.mdx", "II-8": "early-redemption.mdx", "II-9": "prdc.mdx",
  "9": "chapters/parallel-computing.mdx", "10": "chapters/distributed-computing.mdx", "11": "chapters/cnn-fundamentals.mdx",
  "13": "chapters/lookback-convertible.mdx", "14": "chapters/mbs-prdc.mdx", "15": "chapters/automatic-differentiation.mdx",
};
const mdx = (name: string) => read("src", "content", PAGES[name]);
const guideOf = (name: string) => {
  const t = mdx(name); const a = t.indexOf("<UsageGuide");
  return t.slice(a, t.indexOf("\n/>", a) + 3); // the block ends at a line with only "/>" (the steps contain "</>")
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const post = async (endpoint: string) => {
  const res = await fetch(`${baseUrl}/api/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  expect(res.status, endpoint).toBe(200);
  return (await res.json()) as { inputs: Record<string, Record<string, number | string>> };
};
const fmt = (v: number | string) => (typeof v === "number" ? String(v) : v);

/** [guide label, value] must appear as "<b>label</b> value" (an optional "を" before the value; "初期値は value" also counts). */
function expectInitial(guide: string, label: string, value: number | string) {
  const v = esc(fmt(value));
  const re = new RegExp(`<b>${esc(label)}</b>\\s*(?:を\\s*)?${v}(?![0-9.])|<b>${esc(label)}</b>[^<]{0,12}初期値は\\s*${v}(?![0-9.])`);
  expect(re.test(guide), `${label} ${value}`).toBe(true);
}

describe("usage guides: initial values equal the API's default inputs (the manuscript's R examples)", () => {
  it("II-4 Black 76, Monte Carlo, BSM, Longstaff-Schwartz", async () => {
    const { inputs: i } = await post("black"); const g = guideOf("II-4");
    expectInitial(g, "フォワード価格", i.black.forward); expectInitial(g, "行使価格", i.black.strike);
    expectInitial(g, "ボラティリティ（%）", i.black.volPct); expectInitial(g, "無リスク金利（%）", i.black.ratePct);
    expectInitial(g, "現物価格", i.bsm.spot); expectInitial(g, "行使価格", i.bsm.strike); expectInitial(g, "ボラティリティ（%）", i.bsm.volPct);
    expectInitial(g, "無リスク金利（%）", i.bsm.ratePct); expectInitial(g, "配当利回り（%）", i.bsm.dividendPct);
    expect(g).toContain(`${Number(i.mc.paths)} から`); expect(g).toContain(Number(i.lsm.paths).toLocaleString("en-US"));
  });
  it("II-5 CDS: the 1-year flat curve and the 5-year standard CDS", async () => {
    const { inputs: i } = await post("cds"); const g = guideOf("II-5");
    for (const s of ["flat", "isda"] as const) {
      expectInitial(g, "市場 Spread（bp）", i[s].spreadBp); expectInitial(g, "契約 Coupon（bp）", i[s].couponBp);
      expectInitial(g, "Recovery Rate（%）", i[s].recoveryPct); expectInitial(g, "割引率（%）", i[s].ratePct);
    }
  });
  it("II-6 calibration", async () => {
    const { inputs: i } = await post("calibration"); const g = guideOf("II-6");
    expectInitial(g, "フォワード（%）", i.normal.forwardPct); expectInitial(g, "Black ボラ（%）", i.normal.blackVolPct);
    expectInitial(g, "Normal ボラ（bp）", i.normal.normalVolBp); expectInitial(g, "満期（年）", i.normal.expiry);
    expect(g).toContain(`<b>β（固定）</b> を ${i.sabr.beta} から`);
    expectInitial(g, "基準の a（%）", i.hw.aPct); expectInitial(g, "基準の σ（%）", i.hw.sigmaPct); expectInitial(g, "ゼロ金利（%）", i.hw.zeroPct);
    expect(g).toContain(`<b>相関の減衰（基準）</b> を ${i.bgm.decay} から`);
  });
  it("II-7 rate models", async () => {
    const { inputs: i } = await post("rate-models"); const g = guideOf("II-7");
    expectInitial(g, "初期曲線の金利（%）", i.hw.ratePct); expectInitial(g, "平均回帰 a（%）", i.hw.aPct); expectInitial(g, "σ（%）", i.hw.sigmaPct);
    expectInitial(g, "フォワード（%）", i.caplet.forwardPct); expectInitial(g, "行使金利（%）", i.caplet.strikePct); expectInitial(g, "ボラ（%）", i.caplet.volPct);
    expectInitial(g, "満期（年）", i.caplet.expiry); expectInitial(g, "期間（年）", i.caplet.accrual); expectInitial(g, "割引金利（%）", i.caplet.ratePct);
    expectInitial(g, "ρ(A,B)", i.shocks.ab); expectInitial(g, "ρ(A,C)", i.shocks.ac); expectInitial(g, "ρ(B,C)", i.shocks.bc);
    expectInitial(g, "水準（%）", i.fixings.basePct); expectInitial(g, "振幅（%）", i.fixings.amplitudePct); expectInitial(g, "日数", i.fixings.days);
    expect(g).toContain("<b>Black価格</b>");
  });
  it("II-8 callable bond and MBS", async () => {
    const { inputs: i } = await post("callable"); const g = guideOf("II-8");
    expectInitial(g, "初期曲線の金利（%）", i.bond.ratePct); expectInitial(g, "平均回帰 a（%）", i.bond.aPct); expectInitial(g, "σ（%）", i.bond.sigmaPct);
    expectInitial(g, "クーポン（%）", i.bond.couponPct); expectInitial(g, "最初のコール日（年）", i.bond.firstCallYear); expectInitial(g, "コール価格", i.bond.callPrice);
    expectInitial(g, "PSA（%）", i.mbs.psaPct); expectInitial(g, "借換えの感応度 β", i.mbs.incentive); expectInitial(g, "借換えコスト k（%）", i.mbs.refiCostPct);
  });
  it("II-9 PRDC", async () => {
    const { inputs: i } = await post("prdc"); const g = guideOf("II-9");
    expectInitial(g, "FX スポット（円）", i.note.spot); expectInitial(g, "FX ボラ（%）", i.note.volPct); expectInitial(g, "円金利（%）", i.note.domesticPct);
    expectInitial(g, "外貨金利（%）", i.note.foreignPct); expectInitial(g, "割引金利（%）", i.note.discountPct); expectInitial(g, "基準 FX", i.note.fxBase);
    expectInitial(g, "レバレッジ a（%）", i.note.leveragePct); expectInitial(g, "控除 b（%）", i.note.subtractionPct);
    expectInitial(g, "フロア（%）", i.note.floorPct); expectInitial(g, "キャップ（%）", i.note.capPct);
    expect(g).toContain(`${Number(i.mc.paths).toLocaleString("en-US")} から`); expect(g).toContain(`初期値は ${i.mc.seed}`);
  });
  it("9 parallel computing and 15 automatic differentiation", async () => {
    const par = (await (await fetch(`${baseUrl}/api/parallel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json()) as { inputs: { batch: { count: number; maxThreads: number } } };
    const g9 = guideOf("9");
    expectInitial(g9, "債券の件数", par.inputs.batch.count.toLocaleString("en-US")); expectInitial(g9, "スレッド数の上限", par.inputs.batch.maxThreads);
    const { inputs: i } = await post("prdc-risk"); const g15 = guideOf("15");
    expectInitial(g15, "FX スポット（円）", i.market.spot); expectInitial(g15, "FX ボラ（%）", i.market.volPct);
    expectInitial(g15, "パス数", Number(i.mc.paths).toLocaleString("en-US")); expectInitial(g15, "seed", i.mc.seed);
  });
});

describe("usage guides: initial values equal the screen's defaults (components)", () => {
  const src = (f: string) => read("src", "components", f);
  it("II-2 curves: nodes 0.05% to 1.15%, parallel shift 50 bp, node bump 10Y/100 bp", () => {
    const s = src("curves/index.tsx"); const g = guideOf("II-2 curves");
    const rates = /DEFAULT_RATES_PCT = \[([^\]]+)\]/.exec(s)![1].split(",").map(Number);
    expect(g).toContain(`0D ${rates[0].toFixed(2)}%〜10Y ${rates[rates.length - 1].toFixed(2)}%`);
    expect(s).toContain("DEFAULT_SHIFT_BP = 50"); expect(g).toContain("（初期値は 50）");
    expect(s).toContain('DEFAULT_BUMP = { tenor: "10Y", bp: 100 }'); expect(g).toContain("<b>10Y</b> を 1.15 から 2.00");
    expect(rates[rates.length - 1]).toBe(1.15);
  });
  it("II-2 futures: Funding Rate 1.23% and the flat-yield stress 8% / 9%", () => {
    const s = src("futures/index.tsx"); const g = guideOf("II-2 futures");
    expect(s).toContain('DEFAULT: Req = { mode: "current", yieldPct: 8, fundingPct: 1.23 }');
    expect(g).toContain("1.23"); expect(s).toContain('set({ mode: "flat", yieldPct: 8, fundingPct: 9 })');
  });
  it("II-3 OIS: the scenario button is the 5Y quote + 1 bp", () => {
    const s = read("src", "state", "ScenarioContext.tsx"); const g = guideOf("II-3");
    expect(s).toContain('BUMP_TENOR = "5Y"'); expect(s).toContain("BUMP_BP = 1"); expect(g).toContain("5年クォート＋1 bp");
  });
  it("13 lookback, convertible and MSCB", () => {
    const lb = src("lookback/index.tsx"); const cb = src("convertible/index.tsx"); const ms = src("mscb/index.tsx"); const g = guideOf("13");
    expect(lb).toContain("useState(12)"); expect(g).toContain("<b>監視の回数</b> 12");
    expect(cb).toMatch(/\[spread, setSpread\] = useState\(2\)/); expect(g).toContain("<b>信用スプレッド（%）</b> 2 を");
    expect(cb).toMatch(/\[vol, setVol\] = useState\(25\)/); expect(g).toContain("<b>ボラティリティ（%）</b> 25 を");
    expect(ms).toMatch(/\[alpha, setAlpha\] = useState\(0\.9\)/); expect(g).toContain("<b>価格の比 α</b> 0.90");
  });
  it("14 MBS and TARN: the TARN defaults named in the lead", () => {
    const t = src("tarn/index.tsx"); const g = guideOf("14");
    const get = (n: string) => new RegExp(`\\[${n}, set\\w+\\] = useState\\((\\d+)\\)`).exec(t)![1];
    expect(g).toContain(`${get("years")} 年、為替の現物 ${get("spot")}、ボラティリティ ${get("vol")}%、レバレッジ ${get("leverage")}%、控除 ${get("subtraction")}%、キャップ ${get("cap")}%、目標 ${get("target")}%`);
  });
  it("10 distributed jobs: 5 scenarios per job, 2 jobs at a time", () => {
    const s = src("prdcRisk/index.tsx"); const g = guideOf("10");
    expect(s).toContain("[jobSize, setJobSize] = useState(5)"); expect(s).toContain("[concurrency, setConcurrency] = useState(2)");
    expect(g).toContain("1ジョブのシナリオ数 5、同時に送るジョブ数 2");
  });
});

describe("pages: the input ranges and the jump targets", () => {
  // every field the screen limits: label with min and max, as { label, min, max } in the components
  const fields = new Map<string, Set<string>>();
  for (const f of walk(path.join(root, "src", "components")).filter((p) => p.endsWith(".tsx"))) {
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/label: "([^"]+)"[^}]*?min: (-?[\d.]+), max: (-?[\d.]+)/g)) (fields.get(m[1]) ?? fields.set(m[1], new Set()).get(m[1])!).add(`${Number(m[2])}〜${Number(m[3])}`);
    for (const m of t.matchAll(/label="([^"]+)" value=\{[^}]*\} min=\{(-?[\d.]+)\} max=\{(-?[\d.]+)\}/g)) (fields.get(m[1]) ?? fields.set(m[1], new Set()).get(m[1])!).add(`${Number(m[2])}〜${Number(m[3])}`);
    // inputs written inline: min={..} max={..} ... aria-label="section：label"
    for (const m of t.matchAll(/min=\{(-?[\d.]+)\} max=\{(-?[\d.]+)\}[^>]*aria-label="[^"：]*：([^"]+)"/g)) (fields.get(m[3]) ?? fields.set(m[3], new Set()).get(m[3])!).add(`${Number(m[1])}〜${Number(m[2])}`);
  }
  it.each(Object.keys(PAGES))("%s: the ranges listed on the page are the screen's limits", (name) => {
    const lines = mdx(name).split("\n").filter((l) => /^- \*\*.+\*\*：.*〜/.test(l));
    for (const l of lines) {
      const labels = [...l.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
      const range = /：\s*([−-]?[\d.]+)〜([−-]?[\d.]+)/.exec(l);
      if (!range) continue; // not a numeric range, such as "1,000・5,000"
      const text = `${Number(range[1].replace("−", "-"))}〜${Number(range[2].replace("−", "-"))}`;
      for (const label of labels) {
        expect(fields.has(label), `${name}: ${label} is an input of the screen`).toBe(true);
        expect([...fields.get(label)!], `${name}: ${label}`).toContain(text);
      }
    }
  });
  it.each(Object.keys(PAGES))("%s: every jump button points at a heading or an id of the page", (name) => {
    const t = mdx(name); const g = guideOf(name);
    const targets = [...g.matchAll(/to: "([^"]+)"/g)].map((m) => m[1]);
    expect(g.includes("steps={["), name).toBe(true);
    for (const to of targets) {
      const heading = new RegExp(`^#{2,4} ${esc(to)}`, "m").test(t); const id = t.includes(`id="${to}"`);
      expect(heading || id, `${name}: "${to}"`).toBe(true);
    }
  });
});
