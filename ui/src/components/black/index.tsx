import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchBlack, type BlackInputs, type BlackResponse, type BsmInputs, type LsmInputs, type McInputs, type PathRow } from "../../api/black";
import { LineChart } from "../LineChart";
import { FlowChart } from "../FlowChart";

// Components of the Black model chapter (Coral-Book II-4). The reader moves the Black 76 inputs, the Monte Carlo
// settings, the BSM inputs and the Longstaff-Schwartz path count; each change asks the R API (rmql).

type Req = { black: BlackInputs; mc: McInputs; bsm: BsmInputs; lsm: LsmInputs };
type Section = keyof Req;
const DEFAULT: Req = {
  black: { forward: 107 + 6.75 / 32, strike: 107.5, volPct: 5.2, ratePct: 5 },
  mc: { sequence: "pseudo", paths: 200 },
  bsm: { spot: 100, strike: 100, volPct: 20, ratePct: 5, dividendPct: 0 },
  lsm: { paths: 2048 },
};

interface BState {
  data: BlackResponse | null; loading: boolean; error: string | null; req: Req;
  set: <S extends Section>(s: S, p: Partial<Req[S]>) => void; reset: (s: Section) => void;
}
const Ctx = createContext<BState | null>(null);

export function BlackProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState(DEFAULT);
  const [data, setData] = useState<BlackResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchBlack(req, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 250);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [req]);
  const value: BState = {
    data, loading, error, req,
    set: (s, p) => setReq((x) => ({ ...x, [s]: { ...x[s], ...p } })),
    reset: (s) => setReq((x) => ({ ...x, [s]: DEFAULT[s] })),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
function useB(): BState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useB must be used inside BlackProvider");
  return s;
}
function Need({ children }: { children: (d: BlackResponse) => ReactNode }) {
  const { data, error } = useB();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（R APIの応答がないため表示できません）</p>;
  return <p className="muted">計算中…</p>;
}
const Tag = ({ d }: { d: BlackResponse }) => <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>;
const f = (x: number, n: number) => x.toFixed(n);
const pct = (x: number, n = 4) => `${f(x * 100, n)}%`;
const sci = (x: number) => (x === 0 ? "0" : x.toExponential(2));

export function BlackStatus() {
  const { error, loading } = useB();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "計算中…" : ""}</p>;
}

type Field = { key: string; label: string; step: number; min: number; max: number };
const FIELDS: Record<"black" | "bsm", Field[]> = {
  black: [
    { key: "forward", label: "フォワード価格", step: 0.25, min: 1, max: 1000 },
    { key: "strike", label: "行使価格", step: 0.25, min: 1, max: 1000 },
    { key: "volPct", label: "ボラティリティ（%）", step: 0.1, min: 0.1, max: 200 },
    { key: "ratePct", label: "無リスク金利（%）", step: 0.25, min: -5, max: 30 },
  ],
  bsm: [
    { key: "spot", label: "現物価格", step: 1, min: 1, max: 1000 },
    { key: "strike", label: "行使価格", step: 1, min: 1, max: 1000 },
    { key: "volPct", label: "ボラティリティ（%）", step: 1, min: 1, max: 200 },
    { key: "ratePct", label: "無リスク金利（%）", step: 0.25, min: -5, max: 30 },
    { key: "dividendPct", label: "配当利回り（%）", step: 0.25, min: -5, max: 30 },
  ],
};
const NAMES: Record<Section, string> = { black: "Black 76", mc: "モンテカルロ", bsm: "BSM", lsm: "Longstaff–Schwartz" };

function NumberInput({ section, fd, value }: { section: Section; fd: Field; value: number }) {
  const { set } = useB();
  return (
    <label>{fd.label}{" "}
      <input type="number" step={fd.step} min={fd.min} max={fd.max} value={value} className="rate-input" aria-label={`${NAMES[section]}：${fd.label}`}
        onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set(section, { [fd.key]: v } as never); }} />
    </label>
  );
}

/** Inputs of one example. */
export function BlackControls({ which }: { which: Section }) {
  const { req, set, reset, loading, data } = useB();
  return (
    <div className="controls" role="group" aria-label={`${NAMES[which]}の前提`} data-section={which}>
      {(which === "black" || which === "bsm") && FIELDS[which].map((fd) => (
        <NumberInput key={fd.key} section={which} fd={fd} value={(req[which] as unknown as Record<string, number>)[fd.key]} />
      ))}
      {which === "mc" && (
        <>
          <label><input type="radio" name="mcseq" checked={req.mc.sequence === "pseudo"} onChange={() => set("mc", { sequence: "pseudo" })} /> 疑似乱数</label>
          <label><input type="radio" name="mcseq" checked={req.mc.sequence === "sobol"} onChange={() => set("mc", { sequence: "sobol" })} /> Sobol 列</label>
          <label>パス数{" "}
            <select value={req.mc.paths} aria-label="モンテカルロ：パス数" onChange={(e) => set("mc", { paths: Number(e.target.value) })}>
              {[200, 1000, 5000, 20000, 50000].map((n) => <option key={n} value={n}>{n.toLocaleString("ja-JP")}</option>)}
            </select>
          </label>
        </>
      )}
      {which === "lsm" && (
        <label>Sobol パス数{" "}
          <select value={req.lsm.paths} aria-label="Longstaff–Schwartz：パス数" onChange={(e) => set("lsm", { paths: Number(e.target.value) })}>
            {[256, 512, 1024, 2048, 4096, 8192, 16384].map((n) => <option key={n} value={n}>{n.toLocaleString("ja-JP")}</option>)}
          </select>
        </label>
      )}
      <button type="button" onClick={() => reset(which)}>初期値に戻す</button>
      <span className="controls-state">{loading ? "再計算中…" : data ? <Tag d={data} /> : null}</span>
    </div>
  );
}

function KeyValue({ caption, rows, d }: { caption: string; rows: [string, string, string?][]; d: BlackResponse }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <caption>{caption}　<Tag d={d} /></caption>
        <tbody>{rows.map(([k, v, id]) => <tr key={k}><th scope="row">{k}</th><td className="num" data-testid={id}>{v}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** II-4.1.3 and II-4.2: the Black formula and the analytic engine on the Black process. */
export function BlackPanel() {
  return (
    <Need>
      {(d) => {
        const b = d.black, fm = b.formula, pr = b.process;
        return (
          <>
            <div className="tiles">
              <div className="tile emphasis"><div className="tile-label">コール価格（Black 76）</div><div className="tile-value" data-testid="black-value">{f(fm.value, 6)}</div>
                <div className="tile-note">σ√T = {f(b.std_dev, 6)}、D(0,T) = {f(b.discount, 8)}</div></div>
              <div className="tile"><div className="tile-label">Delta（フォワード）</div><div className="tile-value">{f(fm.delta_forward, 6)}</div><div className="tile-note">Gamma {f(fm.gamma_forward, 6)}</div></div>
              <div className="tile"><div className="tile-label">Vega（ボラ1単位）</div><div className="tile-value">{f(fm.vega, 4)}</div><div className="tile-note">Theta {f(pr.theta, 4)}／年、{f(pr.theta_per_day, 6)}／日</div></div>
            </div>
            <div className="table-wrap">
              <table className="data">
                <caption>Black calculator summary と Analytic European call（取引日 {b.trade_date}、満期 {b.expiry_date}、T = {f(b.time, 6)} 年）　<Tag d={d} /></caption>
                <thead><tr><th scope="col">metric</th><th scope="col" className="num">Black 公式（BlackCalculator）</th><th scope="col" className="num">Black process＋解析 Engine</th></tr></thead>
                <tbody>
                  <tr><th scope="row">npv</th><td className="num">{f(fm.value, 10)}</td><td className="num">{f(pr.value, 10)}</td></tr>
                  <tr><th scope="row">delta</th><td className="num">{f(fm.delta_forward, 10)}</td><td className="num">{f(pr.delta, 10)}</td></tr>
                  <tr><th scope="row">gamma</th><td className="num">{f(fm.gamma_forward, 10)}</td><td className="num">{f(pr.gamma, 10)}</td></tr>
                  <tr><th scope="row">vega</th><td className="num">{f(fm.vega, 10)}</td><td className="num">{f(pr.vega, 10)}</td></tr>
                  <tr><th scope="row">theta / theta_per_day</th><td className="num">—</td><td className="num">{f(pr.theta, 8)} / {f(pr.theta_per_day, 10)}</td></tr>
                  <tr><th scope="row">implied_volatility</th><td className="num">—</td><td className="num" data-testid="black-implied">{pct(b.implied_volatility, 6)}</td></tr>
                </tbody>
              </table>
            </div>
          </>
        );
      }}
    </Need>
  );
}

export function BlackValueChart() {
  return (
    <Need>
      {(d) => {
        const r = d.black.by_forward;
        const pts = (k: "value" | "intrinsic") => r.map((x) => ({ x: x.forward, y: x[k], date: `F = ${f(x.forward, 2)}` }));
        const lo = r[0].forward, hi = r[r.length - 1].forward;
        const ticks = []; for (let v = Math.ceil(lo / 2) * 2; v <= hi; v += 2) ticks.push({ x: v, label: String(v) });
        const now = { x: d.black.forward, y: d.black.formula.value, date: `いまのフォワード ${f(d.black.forward, 4)}` };
        return (
          <LineChart title={`Black 76 コール価格とフォワード価格（行使価格 ${d.black.strike}、σ ${pct(d.black.volatility, 2)}、T ${f(d.black.time, 4)} 年）`}
            origin={d.black.trade_date} xMin={lo} xMax={hi} xTicks={ticks} xLabel="フォワード価格" yLabel="価格"
            series={[
              { key: "v", label: "オプション価格", color: "var(--series-1)", points: pts("value") },
              { key: "i", label: "割引した本源的価値 D·max(F−K, 0)", color: "var(--series-2)", dashed: true, points: pts("intrinsic") },
              { key: "now", label: "いまの前提", color: "var(--series-3)", points: [now], dots: [now] },
            ]}
            markers={[{ x: d.black.strike, label: "K" }]} formatY={(y) => y.toFixed(4)} formatTick={(y) => y.toFixed(1)} footer={<Tag d={d} />} />
        );
      }}
    </Need>
  );
}

/** II-4.4.1: the Monte Carlo estimate and its convergence. */
export function McPanel() {
  return (
    <Need>
      {(d) => {
        const m = d.mc;
        const conv = (s: string) => m.convergence.filter((r) => r.sequence === s);
        const xs = [250, 500, 1000, 2000, 5000, 10000, 20000];
        const lx = (n: number) => Math.log10(n);
        const ser = (s: string, color: string, dashed = false) => ({
          key: s, label: s === "pseudo" ? "疑似乱数" : "Sobol 列", color, dashed,
          points: conv(s).map((r) => ({ x: lx(r.paths), y: r.npv, date: `${r.paths.toLocaleString("ja-JP")} パス（${s}）` })),
          dots: conv(s).map((r) => ({ x: lx(r.paths), y: r.npv, date: `${r.paths.toLocaleString("ja-JP")} パス（${s}）` })),
        });
        return (
          <>
            <div className="table-wrap">
              <table className="data">
                <caption>Analytic and Monte Carlo comparison（{m.sequence === "pseudo" ? "疑似乱数" : "Sobol 列"}、{m.paths.toLocaleString("ja-JP")} パス、{m.steps} ステップ）　<Tag d={d} /></caption>
                <thead><tr><th scope="col">method</th><th scope="col" className="num">npv</th><th scope="col" className="num">standard_error</th><th scope="col" className="num">difference_from_analytic</th><th scope="col" className="num">差 ÷ 標準誤差</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Black analytic</th><td className="num">{f(m.analytic, 6)}</td><td className="num">—</td><td className="num">—</td><td className="num">—</td></tr>
                  <tr><th scope="row">Monte Carlo</th><td className="num" data-testid="mc-npv">{f(m.npv, 6)}</td><td className="num">{f(m.standard_error, 6)}</td>
                    <td className="num">{f(m.difference, 6)}</td><td className="num">{f(m.difference / m.standard_error, 2)}</td></tr>
                </tbody>
              </table>
            </div>
            <LineChart title="パス数と Monte Carlo 価格（横軸は対数目盛、点線の目盛りが解析値）" origin={d.black.trade_date} xMin={lx(250)} xMax={lx(20000)}
              xTicks={xs.map((n) => ({ x: lx(n), label: n.toLocaleString("ja-JP") }))} xLabel="パス数" yLabel="価格"
              series={[ser("pseudo", "var(--series-1)"), ser("sobol", "var(--series-2)", true),
                { key: "a", label: "Black analytic", color: "var(--text-muted)", dashed: true, points: [{ x: lx(250), y: m.analytic, date: "解析値" }, { x: lx(20000), y: m.analytic, date: "解析値" }] }]}
              formatY={(y) => y.toFixed(4)} formatTick={(y) => y.toFixed(3)} footer={<Tag d={d} />} />
          </>
        );
      }}
    </Need>
  );
}

/** Paths as a line chart: one thin series per path, no legend, as the manuscript's ggplot2 figure (geom_line, alpha). */
function PathChart({ title, rows, yLabel, origin, footer }: { title: string; rows: PathRow[]; yLabel: string; origin: string; footer?: ReactNode }) {
  const ids = [...new Set(rows.map((r) => r.path_id))];
  const tMax = Math.max(...rows.map((r) => r.time));
  const series = ids.map((id) => ({
    key: `p${id}`, label: `path ${id}`, color: "var(--series-1)", strokeWidth: 0.8, opacity: 0.45,
    points: rows.filter((r) => r.path_id === id).sort((a, b) => a.step - b.step).map((r) => ({ x: r.time, y: r.price, date: `step ${r.step}（${f(r.time, 4)} 年）` })),
  }));
  const ticks = []; const st = tMax > 0.5 ? 0.25 : 0.02;
  for (let v = 0; v <= tMax + 1e-9; v += st) ticks.push({ x: v, label: v.toFixed(2) });
  return (
    <LineChart title={title} origin={origin} xMin={0} xMax={tMax} xTicks={ticks} xLabel="Year" yLabel={yLabel} series={series} legend={false} tooltipRows={4}
      formatY={(y) => y.toFixed(3)} formatTick={(y) => y.toFixed(1)} footer={footer} />
  );
}

/** 120 paths and the terminal distribution. */
export function McPathCharts() {
  return (
    <Need>
      {(d) => {
        const h = d.mc.terminal_histogram;
        const w = h[0].xmax - h[0].xmin;
        const lo = h[0].xmin, hi = h[h.length - 1].xmax;
        const xt = []; const st = (hi - lo) > 8 ? 2 : (hi - lo) > 4 ? 1 : 0.5;
        for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) xt.push({ x: v, label: v.toFixed(st < 1 ? 1 : 0) });
        return (
          <div className="chart-pair">
            <PathChart title={`Black model Monte Carlo paths（${d.mc.sequence === "pseudo" ? "疑似乱数" : "Sobol 列"}、120 本、12 ステップ）`} rows={d.mc.shown_paths}
              yLabel="Forward price" origin={d.black.trade_date} footer={<Tag d={d} />} />
            <FlowChart title="Terminal forward-price distribution（横軸：同じ 120 本の満期価格、24 区間）" origin={d.black.trade_date} xMin={lo} xMax={hi} xTicks={xt}
              yLabel="Count" barWidth={w} legend={false}
              series={[{ key: "n", label: "Count", color: "var(--series-1)" }]}
              bars={h.filter((b) => b.count > 0).map((b) => ({ x: b.x, value: b.count, series: "n", date: `${f(b.xmin, 3)}〜${f(b.xmax, 3)}`, label: "本数" }))}
              formatY={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
          </div>
        );
      }}
    </Need>
  );
}

/** II-4.4.3: one path by hand from the same normal numbers (Sobol). */
export function OnePathTable() {
  return (
    <Need>
      {(d) => (
        <div className="table-wrap">
          <table className="data">
            <caption>One-path hand calculation（Sobol 列の 2〜4 本目、3 ステップ。Z は Sobol 点の逆正規）　<Tag d={d} /></caption>
            <thead><tr><th scope="col">path</th><th scope="col" className="num">step</th><th scope="col" className="num">time</th><th scope="col" className="num">Z</th>
              <th scope="col" className="num">generated_price</th><th scope="col" className="num">hand_price</th><th scope="col" className="num">difference</th></tr></thead>
            <tbody>{d.mc.one_path.map((r) => (
              <tr key={`${r.path_id}-${r.step}`}><th scope="row">{r.path_id}</th><td className="num">{r.step}</td><td className="num">{f(r.time, 6)}</td>
                <td className="num">{r.z == null ? "—" : f(r.z, 6)}</td><td className="num">{f(r.generated_price, 8)}</td><td className="num">{f(r.hand_price, 8)}</td>
                <td className="num">{sci(r.difference)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Need>
  );
}

const METHOD: Record<string, string> = { crr_25: "CRR 25 steps", crr_100: "CRR 100 steps", crr_500: "CRR 500 steps", analytic: "analytic",
  barone_adesi_whaley: "Barone–Adesi–Whaley", bjerksund_stensland: "Bjerksund–Stensland" };

/** II-4.3.2: the European put, analytic and CRR. */
export function EuropeanPutTable() {
  return (
    <Need>
      {(d) => (
        <div className="table-wrap">
          <table className="data">
            <caption>European put engine comparison（S {d.bsm.spot}、K {d.bsm.strike}、σ {pct(d.bsm.volatility, 1)}、r {pct(d.bsm.rate, 2)}、q {pct(d.bsm.dividend, 2)}、T {f(d.bsm.time, 6)} 年）　<Tag d={d} /></caption>
            <thead><tr><th scope="col">method</th><th scope="col" className="num">npv</th><th scope="col" className="num">difference_from_analytic</th></tr></thead>
            <tbody>{d.bsm.european_engines.map((r) => (
              <tr key={r.method}><th scope="row">{METHOD[r.method]}</th><td className="num" data-testid={`eu-${r.method}`}>{f(r.npv, 8)}</td><td className="num">{f(r.difference_from_analytic, 8)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Need>
  );
}

/** II-4.5: the American put, CRR and approximations, and the early-exercise premium. */
export function AmericanPutTable() {
  return (
    <Need>
      {(d) => (
        <>
          <div className="table-wrap">
            <table className="data">
              <caption>American put engine comparison（基準は CRR 500 steps）　<Tag d={d} /></caption>
              <thead><tr><th scope="col">method</th><th scope="col" className="num">npv</th><th scope="col" className="num">difference_from_crr_500</th></tr></thead>
              <tbody>{d.bsm.american_engines.map((r) => (
                <tr key={r.method}><th scope="row">{METHOD[r.method]}</th><td className="num" data-testid={`am-${r.method}`}>{f(r.npv, 8)}</td><td className="num">{f(r.difference_from_crr_500, 8)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="note">早期行使権の価値（American CRR 500 − European 解析解）：<strong data-testid="early-premium">{f(d.bsm.early_exercise_premium, 6)}</strong></p>
        </>
      )}
    </Need>
  );
}

/** CRR convergence by the number of steps (an addition of this page). */
export function TreeConvergenceChart() {
  return (
    <Need>
      {(d) => {
        const r = d.bsm.tree_convergence;
        const pts = (k: "european" | "american") => r.map((x) => ({ x: x.steps, y: x[k], date: `${x.steps} steps` }));
        const am500 = d.bsm.american_engines.find((x) => x.method === "crr_500")!.npv;
        return (
          <LineChart title="CRR Tree のステップ数と put の価格（10〜100 は 1 刻み、その先は 150・200・300・400・500）" origin={d.bsm.trade_date} xMin={10} xMax={500}
            xTicks={[10, 100, 200, 300, 400, 500].map((x) => ({ x, label: String(x) }))} xLabel="ステップ数" yLabel="put の価格"
            series={[
              { key: "eu", label: "European（CRR）", color: "var(--series-1)", points: pts("european") },
              { key: "am", label: "American（CRR）", color: "var(--series-2)", points: pts("american") },
              { key: "an", label: "European 解析解", color: "var(--text-muted)", dashed: true, points: [{ x: 10, y: d.bsm.european.value, date: "解析解" }, { x: 500, y: d.bsm.european.value, date: "解析解" }] },
              { key: "a5", label: "American CRR 500", color: "var(--series-2)", dashed: true, points: [{ x: 10, y: am500, date: "CRR 500" }, { x: 500, y: am500, date: "CRR 500" }] },
            ]}
            formatY={(y) => y.toFixed(4)} formatTick={(y) => y.toFixed(2)} footer={<Tag d={d} />} />
        );
      }}
    </Need>
  );
}

/** II-4.6.1: 64 Sobol paths of the BSM process. */
export function SobolPathChart() {
  return (
    <Need>
      {(d) => (
        <>
          <PathChart title="Black-Scholes-Merton Sobol paths（64 本、12 ステップ）" rows={d.lsm.shown_paths} yLabel="Stock price"
            origin={d.bsm.trade_date} footer={<Tag d={d} />} />
          <p className="note">64 本 × 13 点の価格の合計：{f(d.lsm.first_paths_sum, 6)}（Sobol 列は乱数の種を使わないので、何度計算しても同じパスになります）</p>
        </>
      )}
    </Need>
  );
}

/** II-4.6.2: Longstaff-Schwartz, its exercise timing and the regression diagnostics. */
export function LsmPanel() {
  return (
    <Need>
      {(d) => {
        const l = d.lsm;
        return (
          <>
            <KeyValue d={d} caption={`Longstaff–Schwartz summary と CRR comparison（Sobol ${l.paths.toLocaleString("ja-JP")} パス、${l.steps} ステップ）`} rows={[
              ["lsm_npv", f(l.value, 8), "lsm-value"], ["standard_error", f(l.standard_error, 8)],
              ["CRR Tree 500 steps（American）", f(l.crr_500, 8)], ["difference_from_crr_500", f(l.difference_from_crr_500, 8)],
              ["満期まで行使しなかった、または満期に行使したパス", `${l.exercise.find((e) => e.step === l.steps)?.paths_in_table ?? 0} 本`],
              ["満期前に行使したパスの割合", pct(l.exercise_probability, 2)],
            ]} />
            <div className="table-wrap">
              <table className="data">
                <caption>Longstaff–Schwartz exercise timing と diagnostics（後ろ向きに回帰。境界は行使する株価の上限の目安）</caption>
                <thead><tr><th scope="col" className="num">step</th><th scope="col" className="num">time</th><th scope="col" className="num">そのステップで止まったパス</th>
                  <th scope="col" className="num">ITM のパス</th><th scope="col" className="num">回帰で行使</th><th scope="col" className="num">即時行使価値の平均</th>
                  <th scope="col" className="num">継続価値の平均（実現）</th><th scope="col" className="num">行使境界</th></tr></thead>
                <tbody>{l.exercise.map((e) => {
                  const g = l.regressions.find((r) => r.step === e.step);
                  return (
                    <tr key={e.step}><th scope="row" className="num">{e.step}</th><td className="num">{f(e.time, 4)}</td><td className="num">{e.paths_in_table}</td>
                      <td className="num">{g ? g.in_the_money_paths : "—"}</td><td className="num">{g ? g.exercised_paths : "—"}</td>
                      <td className="num">{g ? f(g.mean_immediate_value, 4) : "—"}</td><td className="num">{g ? f(g.mean_realized_continuation, 4) : "—"}</td>
                      <td className="num">{g?.exercise_boundary == null ? "—" : f(g.exercise_boundary, 3)}</td></tr>
                  );
                })}</tbody>
              </table>
            </div>
          </>
        );
      }}
    </Need>
  );
}
