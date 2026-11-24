import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchCrossTermExample, fetchPrdcThreeFactor, fetchPrdcThreeFactorScan, fetchPrdcThreeFactorScenario, type CrossTermExampleResponse, type ThreeFactorInputs, type ThreeFactorResponse, type ThreeFactorScanResponse, type ThreeFactorScenarioResponse, type ThreeFactorShock } from "../../api/prdcThreeFactor";
import { LineChart } from "../LineChart";
import { FlowChart } from "../FlowChart";
import { WaterfallChart } from "../WaterfallChart";

// Chapter 15's three-factor PRDC: the three correlations are the inputs; the value, the delta and the vega, the correlation
// sensitivities, the cross-gammas and the Vanna come back by automatic differentiation and by finite differences.

const DEFAULT_SHOCK: ThreeFactorShock = { spotYen: 5, volPoints: 2, domesticBp: 20, foreignBp: -20 };
const DEFAULT: ThreeFactorInputs = { correlation: { domesticForeign: 0.3, domesticFx: -0.2, foreignFx: 0.4 } };
const FIELDS: { key: keyof ThreeFactorInputs["correlation"]; label: string; min: number; max: number }[] = [
  { key: "domesticForeign", label: "ρ（円金利, 外貨金利）", min: -0.99, max: 0.99 },
  { key: "domesticFx", label: "ρ（円金利, FX）", min: -0.99, max: 0.99 },
  { key: "foreignFx", label: "ρ（外貨金利, FX）", min: -0.99, max: 0.99 },
];

interface TState {
  data: ThreeFactorResponse | null; loading: boolean; error: string | null; req: ThreeFactorInputs;
  scan: ThreeFactorScanResponse | null; scanning: boolean;
  shock: ThreeFactorShock; setShock: (p: Partial<ThreeFactorShock>) => void; resetShock: () => void;
  scenario: ThreeFactorScenarioResponse | null; scenarioError: string | null; scenarioLoading: boolean;
  set: (p: Partial<ThreeFactorInputs["correlation"]>) => void; reset: () => void;
}
const Ctx = createContext<TState | null>(null);

export function ThreeFactorProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState(DEFAULT);
  const [data, setData] = useState<ThreeFactorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ThreeFactorScanResponse | null>(null);
  const [scanning, setScanning] = useState(true);
  const [shock, setShockState] = useState(DEFAULT_SHOCK);
  const [scenario, setScenario] = useState<ThreeFactorScenarioResponse | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    const id = window.setTimeout(() => {
      setScenarioLoading(true);
      fetchPrdcThreeFactorScenario({ ...req, shock }, { signal: c.signal })
        .then((d) => { setScenario(d); setScenarioError(null); setScenarioLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setScenarioError(e instanceof ApiError ? e.message : String(e));
          setScenarioLoading(false);
        });
    }, 300);
    return () => { c.abort(); window.clearTimeout(id); };
  }, [req, shock]);
  const timer = useRef<number | undefined>(undefined);
  // the graphs take about a second (a valuation for each point), so they are asked for apart from the tables
  useEffect(() => {
    const c = new AbortController();
    const id = window.setTimeout(() => {
      setScanning(true);
      fetchPrdcThreeFactorScan(req, { signal: c.signal })
        .then((d) => { setScan(d); setScanning(false); })
        .catch((e: unknown) => { if (!(e instanceof DOMException && e.name === "AbortError")) { setScan(null); setScanning(false); } });
    }, 400);
    return () => { c.abort(); window.clearTimeout(id); };
  }, [req]);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchPrdcThreeFactor(req, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 300);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [req]);
  const value: TState = { data, loading, error, req, scan, scanning, shock, setShock: (p) => setShockState((x) => ({ ...x, ...p })), resetShock: () => setShockState(DEFAULT_SHOCK), scenario, scenarioError, scenarioLoading, set: (p) => setReq((x) => ({ correlation: { ...x.correlation, ...p } })), reset: () => setReq(DEFAULT) };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
function useT(): TState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useT must be used inside ThreeFactorProvider");
  return s;
}
const Tag = ({ d }: { d: ThreeFactorResponse }) => <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>;
const yen = (x: number) => Math.round(x).toLocaleString("ja-JP");
const num = (x: number, n: number) => x.toLocaleString("ja-JP", { minimumFractionDigits: n, maximumFractionDigits: n });
const sci = (x: number) => (x === 0 ? "0" : x.toExponential(2));

/** The three correlations. A set that is not a correlation matrix is refused by the API and shown as the message. */
export function ThreeFactorControls() {
  const { req, set, reset, loading, error, data } = useT();
  return (
    <div className="controls" role="group" aria-label="3因子 PRDC の相関" data-section="three-factor">
      {FIELDS.map((fd) => (
        <label key={fd.key}>{fd.label}{" "}
          <input type="number" step={0.05} min={fd.min} max={fd.max} className="rate-input" aria-label={`3因子：${fd.label}`}
            value={req.correlation[fd.key]}
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set({ [fd.key]: v }); }} />
        </label>
      ))}
      <button type="button" onClick={reset}>初期値に戻す</button>
      <span className="controls-state">{loading ? "再計算中…" : error ? <span className="error-text" role="alert">{error}</span> : data ? <Tag d={data} /> : null}</span>
    </div>
  );
}

export function ThreeFactorValue() {
  const { data } = useT();
  if (!data) return <p className="muted">計算中…</p>;
  const g = data.greeks;
  return (
    <div className="tiles">
      <div className="tile emphasis"><div className="tile-label">現在価値（3因子、閉じた式）</div><div className="tile-value" data-testid="tf-npv">{yen(data.npv)} 円</div>
        <div className="tile-note">想定元本 1億円、コールなし</div></div>
      <div className="tile"><div className="tile-label">FX デルタ（自動微分）</div><div className="tile-value" data-testid="tf-delta">{yen(g.fx_delta)} 円</div><div className="tile-note">FX 1円あたり</div></div>
      <div className="tile"><div className="tile-label">FX ベガ（自動微分）</div><div className="tile-value" data-testid="tf-vega">{yen(g.fx_vega)} 円</div><div className="tile-note">ボラ 1（100%）あたり</div></div>
    </div>
  );
}

export function ThreeFactorTables() {
  const { data } = useT();
  if (!data) return <p className="muted">計算中…</p>;
  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <caption>相関感応度（相関が +0.01 動いたときの現在価値の変化、円）　<Tag d={data} /></caption>
          <thead><tr><th scope="col">相関</th><th scope="col" className="num">自動微分</th><th scope="col" className="num">有限差分</th><th scope="col" className="num">差</th></tr></thead>
          <tbody>{data.correlation.map((r, i) => (
            <tr key={r.pair}><th scope="row">{r.pair}</th><td className="num" data-testid={`tf-rho-ad-${i}`}>{num(r.automatic_differentiation, 2)}</td>
              <td className="num" data-testid={`tf-rho-fd-${i}`}>{num(r.finite_difference, 2)}</td><td className="num">{sci(r.difference)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption>クロスガンマと Vanna（円）　<Tag d={data} /></caption>
          <thead><tr><th scope="col">感応度</th><th scope="col">単位</th><th scope="col" className="num">2階自動微分</th><th scope="col" className="num">PV の4点差分</th><th scope="col" className="num">差</th></tr></thead>
          <tbody>{data.second_order.map((r, i) => (
            <tr key={r.item}><th scope="row">{r.item}</th><td>{r.unit}</td><td className="num" data-testid={`tf-2nd-ad-${i}`}>{num(r.automatic_differentiation, 3)}</td>
              <td className="num" data-testid={`tf-2nd-fd-${i}`}>{num(r.finite_difference, 3)}</td><td className="num">{sci(r.difference)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <details><summary>定義</summary><p className="note">{data.conventions.second_order}　{data.conventions.bump}</p></details>
    </>
  );
}

const million = (y: number) => (y / 1e6).toFixed(2);
const pts = <R,>(rows: R[], x: (r: R) => number, y: (r: R) => number, label: (r: R) => string) => rows.map((r) => ({ x: x(r), y: y(r), date: label(r) }));

/** The graphs: the value against each correlation, the delta against the rates and the volatility, the vega against the spot.
 *  The dotted line is the tangent from automatic differentiation: its slope is the sensitivity written under the graph. */
export function ThreeFactorCharts() {
  const { scan, scanning, error } = useT();
  if (error) return null;
  if (!scan) return <p className="muted">{scanning ? "グラフを計算中…（1秒ほど）" : "グラフを描けませんでした"}</p>;
  const solid = "var(--series-1)", tangent = "var(--series-2)";
  return (
    <div data-testid="tf-charts" aria-busy={scanning}>
      <h3>相関リスク：現在価値と相関</h3>
      <details><summary>図の見方</summary><p className="note">{scan.conventions.correlation}</p></details>
      <div className="chart-grid-3">
        {scan.correlation.map((c, i) => (
          <LineChart key={c.pair} title={`現在価値と ρ（${c.pair}）`} origin="2026-01-01" xMin={-0.9} xMax={0.9}
            xTicks={[-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9].map((x) => ({ x, label: String(x) }))} xLabel={`ρ（${c.pair}）`} yLabel="現在価値（百万円）" height={245}
            series={[
              { key: "v", label: "現在価値（閉じた式）", color: solid, points: pts(c.points, (r) => r.rho, (r) => r.npv, (r) => `ρ = ${r.rho}`), dots: pts(c.points, (r) => r.rho, (r) => r.npv, (r) => `ρ = ${r.rho}`) },
              { key: "t", label: "自動微分の接線", color: tangent, dashed: true, points: pts(c.points, (r) => r.rho, (r) => r.tangent, (r) => `ρ = ${r.rho}`) },
            ]}
            markers={[{ x: c.current, label: "いまの相関" }]} formatY={(y) => `${million(y)} 百万円`} formatTick={(y) => million(y)}
            footer={<span data-testid={`tf-corr-slope-${i}`}>接線の傾き：相関 +0.01 あたり {num(c.slope * 0.01, 0)} 円</span>} />
        ))}
      </div>
      <h3>クロスガンマ：FX デルタと金利のシフト</h3>
      <details><summary>図の見方</summary><p className="note">{scan.conventions.cross_gamma}</p></details>
      <div className="two-col">
        {(["domestic", "foreign"] as const).map((side) => {
          const g = scan.cross_gamma[side]; const name = side === "domestic" ? "円金利" : "外貨金利";
          return (
            <LineChart key={side} title={`FX デルタと${name}のシフト`} origin="2026-01-01" xMin={-100} xMax={100}
              xTicks={[-100, -50, 0, 50, 100].map((x) => ({ x, label: `${x}` }))} xLabel={`${name}のシフト（bp）`} yLabel="FX デルタ（円／FX 1円）" height={245}
              series={[
                { key: "d", label: "FX デルタ（自動微分）", color: solid, points: pts(g.points, (r) => r.shift_bp, (r) => r.delta, (r) => `${r.shift_bp} bp`), dots: pts(g.points, (r) => r.shift_bp, (r) => r.delta, (r) => `${r.shift_bp} bp`) },
                { key: "t", label: "接線（傾き＝クロスガンマ）", color: tangent, dashed: true, points: pts(g.points, (r) => r.shift_bp, (r) => r.tangent, (r) => `${r.shift_bp} bp`) },
              ]}
              markers={[{ x: 0, label: "いま" }]} formatY={(y) => `${yen(y)} 円`} formatTick={(y) => yen(y)}
              footer={<span data-testid={`tf-xg-slope-${side}`}>クロスガンマ（接線の傾き）：{num(g.slope_per_bp, 3)} 円／（FX 1円 × 1bp）</span>} />
          );
        })}
      </div>
      <h3>Vanna：FX デルタとボラティリティ、FX ベガとスポット</h3>
      <details><summary>図の見方</summary><p className="note">{scan.conventions.vanna}</p></details>
      <div className="two-col">
        <LineChart title="FX デルタと FX ボラ" origin="2026-01-01" xMin={4} xMax={24}
          xTicks={[4, 8, 12, 16, 20, 24].map((x) => ({ x, label: `${x}%` }))} xLabel="FX ボラティリティ（%）" yLabel="FX デルタ（円／FX 1円）" height={245}
          series={[
            { key: "d", label: "FX デルタ（自動微分）", color: solid, points: pts(scan.vanna.delta_by_vol.points, (r) => r.vol_pct, (r) => r.delta, (r) => `ボラ ${r.vol_pct}%`), dots: pts(scan.vanna.delta_by_vol.points, (r) => r.vol_pct, (r) => r.delta, (r) => `ボラ ${r.vol_pct}%`) },
            { key: "t", label: "接線（傾き＝Vanna）", color: tangent, dashed: true, points: pts(scan.vanna.delta_by_vol.points, (r) => r.vol_pct, (r) => r.tangent, (r) => `ボラ ${r.vol_pct}%`) },
          ]}
          markers={[{ x: scan.vanna.delta_by_vol.current, label: "いまのボラ" }]} formatY={(y) => `${yen(y)} 円`} formatTick={(y) => yen(y)}
          footer={<span data-testid="tf-vanna-slope-vol">Vanna（接線の傾き）：{num(scan.vanna.delta_by_vol.slope_per_point, 1)} 円／（FX 1円 × ボラ 1ポイント）</span>} />
        <LineChart title="FX ベガと FX スポット" origin="2026-01-01" xMin={110} xMax={190}
          xTicks={[110, 130, 150, 170, 190].map((x) => ({ x, label: String(x) }))} xLabel="FX スポット（円）" yLabel="FX ベガ（円／ボラ 1ポイント）" height={245}
          series={[
            { key: "v", label: "FX ベガ（自動微分）", color: solid, points: pts(scan.vanna.vega_by_spot.points, (r) => r.spot, (r) => r.vega, (r) => `スポット ${r.spot} 円`), dots: pts(scan.vanna.vega_by_spot.points, (r) => r.spot, (r) => r.vega, (r) => `スポット ${r.spot} 円`) },
            { key: "t", label: "接線（傾き＝Vanna）", color: tangent, dashed: true, points: pts(scan.vanna.vega_by_spot.points, (r) => r.spot, (r) => r.tangent, (r) => `スポット ${r.spot} 円`) },
          ]}
          markers={[{ x: scan.vanna.vega_by_spot.current, label: "いまのスポット" }]} formatY={(y) => `${yen(y)} 円`} formatTick={(y) => yen(y)}
          footer={<span data-testid="tf-vanna-slope-spot">Vanna（接線の傾き）：{num(scan.vanna.vega_by_spot.slope_per_yen, 1)} 円／（FX 1円 × ボラ 1ポイント）</span>} />
      </div>
      <p className="muted"><span className="response-tag" data-request-id={scan.response.request_id}>API応答 <code>{scan.response.request_id}</code></span></p>
    </div>
  );
}

const SHOCK_FIELDS: { key: keyof ThreeFactorShock; label: string; min: number; max: number; step: number }[] = [
  { key: "spotYen", label: "FX スポットの変化（円）", min: -50, max: 50, step: 1 },
  { key: "volPoints", label: "FX ボラの変化（ポイント）", min: -8, max: 12, step: 0.5 },
  { key: "domesticBp", label: "円金利のシフト（bp）", min: -200, max: 200, step: 5 },
  { key: "foreignBp", label: "外貨金利のシフト（bp）", min: -200, max: 200, step: 5 },
];

/** The four moves of the scenario. */
export function ThreeFactorScenarioControls() {
  const { shock, setShock, resetShock, scenarioLoading, scenarioError, scenario } = useT();
  return (
    <div className="controls" role="group" aria-label="シナリオ（同時に動かす）" data-section="three-factor-scenario">
      {SHOCK_FIELDS.map((fd) => (
        <label key={fd.key}>{fd.label}{" "}
          <input type="number" step={fd.step} min={fd.min} max={fd.max} className="rate-input" aria-label={`シナリオ：${fd.label}`} value={shock[fd.key]}
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) setShock({ [fd.key]: v }); }} />
        </label>
      ))}
      <button type="button" onClick={resetShock}>初期値に戻す</button>
      <span className="controls-state">{scenarioLoading ? "再計算中…" : scenarioError ? <span className="error-text" role="alert">{scenarioError}</span> : scenario ? <span className="response-tag" data-request-id={scenario.response.request_id}>API応答 <code>{scenario.response.request_id}</code></span> : null}</span>
    </div>
  );
}

const sgn = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x)).toLocaleString("ja-JP")}`;

/** The profit and loss three ways, the Greeks' contributions and the differences from the full revaluation. */
export function ThreeFactorScenario() {
  const { scenario: s, scenarioError } = useT();
  if (!s) return <p className="muted">{scenarioError ? "（直前の入力では計算できません。値を戻してください）" : "計算中…"}</p>;
  const first = "var(--series-1)", cross = "var(--series-2)", gap = "var(--series-3)", total = "var(--text-muted)";
  const c = s.contribution;
  const contributionBars = c.map((r, i) => ({ date: r.item, x: i + 1, value: r.value, series: r.kind, label: r.item }));
  const comparison = [
    { short: "フル再評価", value: s.pnl.full, series: "total", label: "フル再評価による損益" },
    { short: "一次近似", value: s.pnl.first_order, series: "first", label: "一次近似の損益" },
    { short: "一次＋交差項", value: s.pnl.first_plus_cross, series: "cross", label: "一次近似にクロスガンマ2種と Vanna を加えた損益" },
    { short: "フル − 一次", value: s.pnl.difference_first_order, series: "gap", label: "フル再評価と一次近似の差" },
    { short: "フル − 一次＋交差項", value: s.pnl.difference_first_plus_cross, series: "gap", label: "フル再評価と（一次近似＋交差項）の差" },
  ];
  const comparisonBars = comparison.map((r, i) => ({ date: r.label, x: i + 1, value: r.value, series: r.series, label: r.label }));
  const million = (y: number) => `${(y / 1e6).toFixed(2)}`;
  return (
    <div data-testid="tf-scenario">
      <div className="tiles">
        <div className="tile emphasis"><div className="tile-label">フル再評価による損益</div><div className="tile-value" data-testid="tf-pnl-full">{sgn(s.pnl.full)} 円</div>
          <div className="tile-note">スポット {s.base.spot}→{s.moved.spot} 円、ボラ {s.base.fx_volatility_pct.toFixed(1)}→{s.moved.fx_volatility_pct.toFixed(1)}%</div></div>
        <div className="tile"><div className="tile-label">一次近似</div><div className="tile-value" data-testid="tf-pnl-first">{sgn(s.pnl.first_order)} 円</div>
          <div className="tile-note">フル再評価との差 <span data-testid="tf-diff-first">{sgn(s.pnl.difference_first_order)}</span> 円</div></div>
        <div className="tile"><div className="tile-label">一次近似＋クロスガンマ2種＋Vanna</div><div className="tile-value" data-testid="tf-pnl-cross">{sgn(s.pnl.first_plus_cross)} 円</div>
          <div className="tile-note">フル再評価との差 <span data-testid="tf-diff-cross">{sgn(s.pnl.difference_first_plus_cross)}</span> 円</div></div>
      </div>
      <div className="two-col">
        <FlowChart title="各グリークスの損益への寄与" origin="2026-01-01" xMin={0.4} xMax={c.length + 0.6} barWidth={0.6}
          xTicks={c.map((r, i) => ({ x: i + 1, label: r.short }))} yLabel="損益への寄与（百万円）" legend
          series={[{ key: "first", label: "一次（デルタ・ベガ・DV01）", color: first }, { key: "cross", label: "交差項（クロスガンマ・Vanna）", color: cross }]}
          bars={contributionBars} formatY={(y) => `${million(y)} 百万円`} />
        <FlowChart title="損益の比較とフル再評価との差" origin="2026-01-01" xMin={0.4} xMax={comparison.length + 0.6} barWidth={0.6}
          xTicks={comparison.map((r, i) => ({ x: i + 1, label: r.short }))} yLabel="損益（百万円）" legend
          series={[{ key: "total", label: "フル再評価", color: total }, { key: "first", label: "一次近似", color: first }, { key: "cross", label: "一次近似＋交差項", color: cross }, { key: "gap", label: "フル再評価との差", color: gap }]}
          bars={comparisonBars} formatY={(y) => `${million(y)} 百万円`} />
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption>損益の内訳（円）</caption>
          <thead><tr><th scope="col">項目</th><th scope="col" className="num">寄与</th></tr></thead>
          <tbody>
            {c.map((r) => <tr key={r.item}><th scope="row">{r.item}</th><td className="num">{sgn(r.value)}</td></tr>)}
            <tr><th scope="row">一次近似（上の4行の和）</th><td className="num">{sgn(s.pnl.first_order)}</td></tr>
            <tr><th scope="row">一次近似＋交差項（7行の和）</th><td className="num">{sgn(s.pnl.first_plus_cross)}</td></tr>
            <tr><th scope="row">フル再評価</th><td className="num">{sgn(s.pnl.full)}</td></tr>
          </tbody>
        </table>
      </div>
      <details><summary>損益の定義</summary><p className="note">{s.conventions.full}　{s.conventions.first_order}　{s.conventions.cross}　{s.conventions.rest}</p></details>
    </div>
  );
}

const CROSS_FIELDS: { key: "bondPct" | "fxPct"; label: string; min: number; max: number; step: number }[] = [
  { key: "bondPct", label: "ドル建て債券価格の変化（%）", min: -50, max: 50, step: 0.5 },
  { key: "fxPct", label: "ドル円の変化（%）", min: -50, max: 50, step: 0.5 },
];
const pt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;

/** The example of the cross term: an unhedged foreign bond, as a waterfall (bond, FX, cross term, yen return). It has its own inputs. */
export function CrossTermExample() {
  const [x, setX] = useState({ bondPct: -2, fxPct: 5 });
  const [data, setData] = useState<CrossTermExampleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    const id = window.setTimeout(() => {
      fetchCrossTermExample(x, { signal: c.signal })
        .then((d) => { setData(d); setError(null); })
        .catch((e: unknown) => { if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof ApiError ? e.message : String(e)); });
    }, 200);
    return () => { c.abort(); window.clearTimeout(id); };
  }, [x]);
  const colors = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
  return (
    <div data-testid="cross-term-example">
      <div className="controls" role="group" aria-label="為替ヘッジなし外債の例" data-section="cross-term">
        {CROSS_FIELDS.map((fd) => (
          <label key={fd.key}>{fd.label}{" "}
            <input type="number" step={fd.step} min={fd.min} max={fd.max} className="rate-input" aria-label={`外債の例：${fd.label}`} value={x[fd.key]}
              onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) setX((o) => ({ ...o, [fd.key]: v })); }} />
          </label>
        ))}
        <button type="button" onClick={() => setX({ bondPct: -2, fxPct: 5 })}>初期値に戻す</button>
        <span className="controls-state">{error ? <span className="error-text" role="alert">{error}</span> : null}</span>
      </div>
      {data && (
        <WaterfallChart title="為替ヘッジなし外債の円建てリターン" yLabel="ポイント（%）" formatValue={(v) => `${pt(v)} ポイント`} formatTick={(v) => v.toFixed(1)}
          steps={[
            ...data.steps.map((s, i) => ({ label: s.item, value: s.value_pt, kind: "delta" as const, color: colors[i] })),
            { label: "円建てリターン", value: data.total_pct, kind: "total" as const, color: "var(--text-muted)" },
          ]}
          footer={<span data-testid="cross-total">円建てリターン {pt(data.total_pct)}%</span>} />
      )}
      {data && <details><summary>定義</summary><p className="note">{data.conventions.return}</p></details>}
    </div>
  );
}
