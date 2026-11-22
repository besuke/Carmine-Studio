import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchRateModels, type CapletInputs, type FixingInputs, type HwInputs, type RateModelsResponse, type ShockInputs } from "../../api/rateModels";
import { LineChart } from "../LineChart";
import { FlowChart } from "../FlowChart";

// Components of the interest-rate models chapter (Coral-Book II-7). The reader moves the Hull-White parameters,
// the caplet, the target correlations and the fictitious fixings; each change asks the R API.

type Req = { hw: HwInputs; caplet: CapletInputs; shocks: ShockInputs; fixings: FixingInputs };
type Section = keyof Req;
const DEFAULT: Req = {
  hw: { ratePct: 2, aPct: 12, sigmaPct: 1 },
  caplet: { forwardPct: 2.5, strikePct: 2.75, volPct: 24, expiry: 2, accrual: 0.5, ratePct: 2 },
  shocks: { ab: 0.8, ac: 0.5, bc: 0.7 },
  fixings: { basePct: 1, amplitudePct: 0.4, days: 90 },
};

interface RState {
  data: RateModelsResponse | null; loading: boolean; error: string | null; req: Req;
  set: <S extends Section>(s: S, p: Partial<Req[S]>) => void; reset: (s: Section) => void;
}
const Ctx = createContext<RState | null>(null);

export function RateModelsProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState(DEFAULT);
  const [data, setData] = useState<RateModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchRateModels(req, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 300);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [req]);
  const value: RState = {
    data, loading, error, req,
    set: (s, p) => setReq((x) => ({ ...x, [s]: { ...x[s], ...p } })),
    reset: (s) => setReq((x) => ({ ...x, [s]: DEFAULT[s] })),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
function useR(): RState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useR must be used inside RateModelsProvider");
  return s;
}
function Need({ children }: { children: (d: RateModelsResponse) => ReactNode }) {
  const { data, error } = useR();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（直前の入力では計算できません。値を戻してください）</p>;
  return <p className="muted">計算中…</p>;
}
const Tag = ({ d }: { d: RateModelsResponse }) => <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>;
const f = (x: number, n: number) => x.toFixed(n);
const pct = (x: number, n = 4) => `${f(x * 100, n)}%`;
const sci = (x: number) => (x === 0 ? "0" : x.toExponential(2));

export function RateModelsStatus() {
  const { error, loading } = useR();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "計算中…" : ""}</p>;
}

type Field = { key: string; label: string; step: number; min: number; max: number };
const FIELDS: Record<Section, Field[]> = {
  hw: [
    { key: "ratePct", label: "初期曲線の金利（%）", step: 0.25, min: -2, max: 15 },
    { key: "aPct", label: "平均回帰 a（%）", step: 1, min: 0.5, max: 100 },
    { key: "sigmaPct", label: "σ（%）", step: 0.1, min: 0.01, max: 5 },
  ],
  caplet: [
    { key: "forwardPct", label: "フォワード（%）", step: 0.25, min: 0.01, max: 20 },
    { key: "strikePct", label: "行使金利（%）", step: 0.25, min: 0.01, max: 20 },
    { key: "volPct", label: "ボラ（%）", step: 1, min: 1, max: 200 },
    { key: "expiry", label: "満期（年）", step: 0.5, min: 0.1, max: 30 },
    { key: "accrual", label: "期間（年）", step: 0.25, min: 0.05, max: 2 },
    { key: "ratePct", label: "割引金利（%）", step: 0.25, min: -2, max: 15 },
  ],
  shocks: [
    { key: "ab", label: "ρ(A,B)", step: 0.05, min: -0.99, max: 0.99 },
    { key: "ac", label: "ρ(A,C)", step: 0.05, min: -0.99, max: 0.99 },
    { key: "bc", label: "ρ(B,C)", step: 0.05, min: -0.99, max: 0.99 },
  ],
  fixings: [
    { key: "basePct", label: "水準（%）", step: 0.25, min: -2, max: 15 },
    { key: "amplitudePct", label: "振幅（%）", step: 0.1, min: 0, max: 5 },
    { key: "days", label: "日数", step: 1, min: 5, max: 400 },
  ],
};
const NAMES: Record<Section, string> = { hw: "Hull–White", caplet: "キャップレット", shocks: "相関", fixings: "後決め金利" };

export function RateModelsControls({ which }: { which: Section }) {
  const { req, set, reset, loading, data, error } = useR();
  return (
    <div className="controls" role="group" aria-label={`${NAMES[which]}の前提`} data-section={which}>
      {FIELDS[which].map((fd) => (
        <label key={fd.key}>{fd.label}{" "}
          <input type="number" step={fd.step} min={fd.min} max={fd.max} className="rate-input" aria-label={`${NAMES[which]}：${fd.label}`}
            value={(req[which] as unknown as Record<string, number>)[fd.key]}
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set(which, { [fd.key]: v } as never); }} />
        </label>
      ))}
      <button type="button" onClick={() => reset(which)}>初期値に戻す</button>
      <span className="controls-state">{loading ? "再計算中…" : error ? <span className="error-text">{error}</span> : data ? <Tag d={data} /> : null}</span>
    </div>
  );
}

const yearTicks = (max: number, step: number) => { const t = []; for (let v = 0; v <= max + 1e-9; v += step) t.push({ x: v, label: String(v) }); return t; };

/** II-7.2: Hull-White short-rate paths, their band and phi(t). */
export function HwPathsChart() {
  return (
    <Need>
      {(d) => {
        const h = d.hw;
        const line = (ys: number[], label: string) => ys.map((y, i) => ({ x: h.times[i], y: 100 * y, date: `${f(h.times[i], 3)} 年（${label}）` }));
        const paths = h.sample_paths.map((p, i) => ({ key: `p${i}`, label: i === 0 ? "経路（8本）" : `経路 ${i + 1}`, inLegend: i === 0,
          color: "var(--series-1)", strokeWidth: 1, opacity: 0.55, points: line(p, `経路 ${i + 1}`) }));
        return (
          <LineChart title={`Hull–White モデルによる短期金利の経路例（8本。帯は ${h.paths.toLocaleString("ja-JP")} 本の 5%・95% 点、a = ${pct(h.a, 1)}、σ = ${pct(h.sigma, 2)}）`}
            origin="2026-01-01" xMin={0} xMax={5} xTicks={yearTicks(5, 1)} xLabel="経過年数" yLabel="短期金利（%）" tooltipRows={12} legend
            series={[
              ...paths,
              { key: "q05", label: "5% 点", color: "var(--text-muted)", dashed: true, points: line(h.quantile_05, "5% 点") },
              { key: "q95", label: "95% 点", color: "var(--text-muted)", dashed: true, points: line(h.quantile_95, "95% 点") },
              { key: "phi", label: "φ(t)（決定論的な項）", color: "var(--series-3)", points: line(h.shift, "φ(t)") },
              { key: "m", label: "8000本の平均", color: "var(--series-2)", strokeWidth: 2.5, points: line(h.mean_path, "平均") },
            ]}
            formatY={(y) => `${y.toFixed(3)}%`} formatTick={(y) => `${y.toFixed(1)}%`} footer={<Tag d={d} />} />
        );
      }}
    </Need>
  );
}

export function HwDiscountTable() {
  return (
    <Need>
      {(d) => (
        <div className="table-wrap">
          <table className="data">
            <caption>初期割引曲線と経路別割引の平均（初期曲線 {pct(d.hw.flat_rate, 2)} のフラット）　<Tag d={d} /></caption>
            <thead><tr><th scope="col">モデル</th><th scope="col" className="num">満期（年）</th><th scope="col" className="num">initial_curve</th><th scope="col" className="num">simulation</th>
              <th scope="col" className="num">mc_standard_error</th><th scope="col" className="num">difference</th><th scope="col" className="num">差 ÷ 標準誤差</th></tr></thead>
            <tbody>{d.hw.discount_check.map((r, i) => (
              <tr key={`${r.model}-${r.maturity}`}><th scope="row">{r.model}</th><td className="num">{r.maturity}</td><td className="num">{f(r.initial_curve, 8)}</td>
                <td className="num" data-testid={`hw-disc-${i}`}>{f(r.simulation, 8)}</td><td className="num">{sci(r.mc_standard_error)}</td><td className="num">{sci(r.difference)}</td>
                <td className="num">{f(r.difference / r.mc_standard_error, 2)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Need>
  );
}

/** II-7.3: the forward-rate loading of one-factor Hull-White. */
export function HjmLoadingChart() {
  return (
    <Need>
      {(d) => (
        <LineChart title={`1因子 Hull–White に対応するフォワードの変動係数 σ e^(−a(T−t))（a = ${pct(d.hw.a, 1)}、σ = ${pct(d.hw.sigma, 2)}）`} origin="2026-01-01"
          xMin={0} xMax={15} xTicks={yearTicks(15, 3)} xLabel="ショック時点から満期までの年数" yLabel="瞬間フォワードの係数（bp）"
          series={[{ key: "l", label: "係数", color: "var(--series-1)", points: d.hw.hjm_loading.map((r) => ({ x: r.time_to_maturity, y: 1e4 * r.forward_volatility, date: `${f(r.time_to_maturity, 1)} 年` })) }]}
          formatY={(y) => `${y.toFixed(2)}bp`} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
      )}
    </Need>
  );
}

/** Caplet by Black's formula and by simulation, and the distribution of its forward rate. */
export function CapletPanel() {
  return (
    <Need>
      {(d) => {
        const c = d.caplet;
        const h = c.terminal_histogram.filter((b) => b.count > 0);
        const w = c.terminal_histogram[0].xmax - c.terminal_histogram[0].xmin;
        const lo = c.terminal_histogram[0].xmin, hi = c.terminal_histogram[c.terminal_histogram.length - 1].xmax;
        const st = hi - lo > 12 ? 2 : hi - lo > 6 ? 1 : 0.5;
        const xt = []; for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) xt.push({ x: v, label: `${Number(v.toFixed(1))}%` });
        return (
          <div className="two-col">
            <div>
              <div className="table-wrap">
                <table className="data">
                  <caption>Caplet 価格：公式と周辺分布（想定元本 1 に対する bp。{c.paths.toLocaleString("ja-JP")} 本、seed {c.seed}）　<Tag d={d} /></caption>
                  <thead><tr><th scope="col">black_price</th><th scope="col">simulated_price</th><th scope="col">mc_standard_error</th><th scope="col">difference</th><th scope="col">差 ÷ 標準誤差</th></tr></thead>
                  <tbody><tr>
                    <td className="num" data-testid="caplet-black">{f(1e4 * c.black_price, 6)}</td><td className="num" data-testid="caplet-mc">{f(1e4 * c.simulated_price, 6)}</td>
                    <td className="num">{f(1e4 * c.mc_standard_error, 6)}</td><td className="num">{f(1e4 * (c.simulated_price - c.black_price), 6)}</td>
                    <td className="num">{f((c.simulated_price - c.black_price) / c.mc_standard_error, 2)}</td></tr></tbody>
                </table>
              </div>
              <p className="note">同じ条件の<strong>後決め</strong>キャップレット（金利期間 {c.expiry}〜{c.expiry + c.accrual} 年の翌日物の複利。期間中もボラが減衰しながら効く）は {f(1e4 * c.backward_price, 6)} bp で、
                前決めの {f(1e4 * c.black_price, 6)} bp より {c.backward_price > c.black_price ? "高く" : "低く"}なります。</p>
            </div>
            <FlowChart title={`満期のフォワード金利 L(T) の分布（行使金利 ${pct(c.strike, 2)} を超える割合 ${pct(c.in_the_money, 1)}、平均 ${pct(c.terminal_mean, 4)} ≈ L(0)）`}
              origin="2026-01-01" xMin={lo} xMax={hi} xTicks={xt} barWidth={w} yLabel="本数" legend
              series={[{ key: "otm", label: "行使金利以下", color: "var(--series-1)" }, { key: "itm", label: "行使金利超（Payoff あり）", color: "var(--series-2)" }]}
              bars={h.map((b) => ({ x: b.x, value: b.count, series: b.x > 100 * c.strike ? "itm" : "otm", date: `${f(b.xmin, 3)}%〜${f(b.xmax, 3)}%`, label: "本数" }))}
              formatY={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
          </div>
        );
      }}
    </Need>
  );
}

/** Target and sample correlations, and the shocks. */
export function ShockPanel() {
  return (
    <Need>
      {(d) => {
        const s = d.shocks;
        const names = ["A", "B", "C"];
        const cell = (a: string, b: string) => s.table.find((r) => r.forward_1 === a && r.forward_2 === b)!;
        const dots = (k: "b" | "c") => s.scatter.map((p, i) => ({ x: p.a, y: p[k], date: `${i}` }));
        return (
          <div className="two-col">
            <div className="table-wrap">
              <table className="data">
                <caption>相関ショックの目標値と標本値（{s.paths.toLocaleString("ja-JP")} 組、seed {s.seed}。各セルは 目標 → 標本）　<Tag d={d} /></caption>
                <thead><tr><th scope="col"></th>{names.map((n) => <th key={n} scope="col" className="num">{n}</th>)}</tr></thead>
                <tbody>{names.map((a) => (
                  <tr key={a}><th scope="row">{a}</th>{names.map((b) => <td key={b} className="num" data-testid={`corr-${a}${b}`}>{f(cell(a, b).target, 2)} → {f(cell(a, b).simulated, 6)}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
            <LineChart title="相関ショックの散布図（先頭 400 組）：A に対する B と C" origin="2026-01-01" xMin={-4} xMax={4} height={280}
              xTicks={[-4, -2, 0, 2, 4].map((x) => ({ x, label: String(x) }))} xLabel="ショック A" yLabel="ショック B・C"
              series={[{ key: "b", label: `B（目標 ρ = ${f(cell("A", "B").target, 2)}）`, color: "var(--series-1)", points: [], dots: dots("b") },
                { key: "c", label: `C（目標 ρ = ${f(cell("A", "C").target, 2)}）`, color: "var(--series-2)", points: [], dots: dots("c") }]}
              formatY={(y) => y.toFixed(2)} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
          </div>
        );
      }}
    </Need>
  );
}

/** II-7.5: compounding of the fictitious daily fixings. */
export function FixingsPanel() {
  return (
    <Need>
      {(d) => {
        const x = d.fixings;
        const pt = (k: "overnight_rate" | "realized_rate_to_date") => x.daily.map((r) => ({ x: r.observation, y: 100 * r[k], date: `${r.observation} 日目` }));
        return (
          <>
            <div className="tiles">
              <div className="tile emphasis"><div className="tile-label">確定後の期間金利（{x.days} 日の複利）</div><div className="tile-value" data-testid="compounded">{pct(x.compounded_rate, 6)}</div>
                <div className="tile-note">(∏(1 + δR) − 1) / Δ</div></div>
              <div className="tile"><div className="tile-label">日次金利の単純平均</div><div className="tile-value">{pct(x.simple_average, 6)}</div>
                <div className="tile-note">差 {f(1e4 * (x.compounded_rate - x.simple_average), 4)} bp（複利の効果）</div></div>
            </div>
            <LineChart title="当日までに確定した金利から計算した複利金利" origin="2026-01-01" xMin={1} xMax={x.days}
              xTicks={[1, ...[0.25, 0.5, 0.75, 1].map((r) => Math.round(r * x.days))].map((v) => ({ x: v, label: String(v) }))} xLabel="金利期間内の観測日" yLabel="年率（%）"
              series={[{ key: "r", label: "観測済み部分の年率換算", color: "var(--series-1)", points: pt("realized_rate_to_date") },
                { key: "o", label: "その日の翌日物金利", color: "var(--series-2)", dashed: true, points: pt("overnight_rate") }]}
              formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => `${y.toFixed(2)}%`} footer={<Tag d={d} />} />
          </>
        );
      }}
    </Need>
  );
}
