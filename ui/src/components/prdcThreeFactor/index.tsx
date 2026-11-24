import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchPrdcThreeFactor, fetchPrdcThreeFactorScan, type ThreeFactorInputs, type ThreeFactorResponse, type ThreeFactorScanResponse } from "../../api/prdcThreeFactor";
import { LineChart } from "../LineChart";

// Chapter 15's three-factor PRDC: the three correlations are the inputs; the value, the delta and the vega, the correlation
// sensitivities, the cross-gammas and the Vanna come back by automatic differentiation and by finite differences.

const DEFAULT: ThreeFactorInputs = { correlation: { domesticForeign: 0.3, domesticFx: -0.2, foreignFx: 0.4 } };
const FIELDS: { key: keyof ThreeFactorInputs["correlation"]; label: string; min: number; max: number }[] = [
  { key: "domesticForeign", label: "ρ（円金利, 外貨金利）", min: -0.99, max: 0.99 },
  { key: "domesticFx", label: "ρ（円金利, FX）", min: -0.99, max: 0.99 },
  { key: "foreignFx", label: "ρ（外貨金利, FX）", min: -0.99, max: 0.99 },
];

interface TState {
  data: ThreeFactorResponse | null; loading: boolean; error: string | null; req: ThreeFactorInputs;
  scan: ThreeFactorScanResponse | null; scanning: boolean;
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
  const value: TState = { data, loading, error, req, scan, scanning, set: (p) => setReq((x) => ({ correlation: { ...x.correlation, ...p } })), reset: () => setReq(DEFAULT) };
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
      <p className="note">{data.conventions.second_order}　{data.conventions.bump}</p>
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
      <p className="note">{scan.conventions.correlation}</p>
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
      <p className="note">{scan.conventions.cross_gamma}</p>
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
      <p className="note">{scan.conventions.vanna}</p>
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
