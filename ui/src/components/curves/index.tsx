import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchZeroCurves, type CurvePointRow, type ZeroCurvesResponse } from "../../api/curves";
import { LineChart, type Series } from "../LineChart";

// Components of the yield-curve chapter (Coral-Book II-2). The reader edits the zero-rate nodes and the
// parallel shift; every change asks the R API (rmql) for the curves. Figures follow the manuscript's
// ggplot2 figures: date on the x-axis, rates in percent, line type for the interpolation target.

const DEFAULT_RATES_PCT = [0.05, 0.06, 0.08, 0.11, 0.18, 0.32, 0.48, 0.75, 1.15];
const DEFAULT_SHIFT_BP = 50;
const NODE_TENORS = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y"];
const DEFAULT_BUMP = { tenor: "10Y", bp: 100 };

interface CurveState {
  data: ZeroCurvesResponse | null;
  loading: boolean;
  error: string | null;
  ratesPct: number[];
  shiftBp: number;
  bump: { tenor: string; bp: number };
  setBump: (b: { tenor: string; bp: number }) => void;
  setRate: (i: number, v: number) => void;
  setShiftBp: (v: number) => void;
  reset: () => void;
}

const Ctx = createContext<CurveState | null>(null);

export function CurveProvider({ children }: { children: ReactNode }) {
  const [ratesPct, setRates] = useState(DEFAULT_RATES_PCT);
  const [shiftBp, setShift] = useState(DEFAULT_SHIFT_BP);
  const [bump, setBump] = useState(DEFAULT_BUMP);
  const [data, setData] = useState<ZeroCurvesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    // a short pause so that typing a number sends one request
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchZeroCurves({ zeroRatesPct: ratesPct, shiftBp, bump }, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 250);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [ratesPct, shiftBp, bump]);
  const value: CurveState = {
    data, loading, error, ratesPct, shiftBp, bump, setBump,
    setRate: (i, v) => setRates((r) => r.map((x, k) => (k === i ? v : x))),
    setShiftBp: setShift,
    reset: () => { setRates(DEFAULT_RATES_PCT); setShift(DEFAULT_SHIFT_BP); setBump(DEFAULT_BUMP); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useCurves(): CurveState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useCurves must be used inside CurveProvider");
  return s;
}

function Need({ children }: { children: (d: ZeroCurvesResponse) => ReactNode }) {
  const { data, error } = useCurves();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（R APIの応答がないため表示できません）</p>;
  return <p className="muted">計算中…</p>;
}

const Tag = ({ d }: { d: ZeroCurvesResponse }) => (
  <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>
);
const pctS = (x: number | null | undefined, digits = 4) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(digits)}%`);
const pts = (rows: CurvePointRow[], pick: (r: CurvePointRow) => number | null) =>
  rows.flatMap((r) => { const y = pick(r); return y === null || !Number.isFinite(y) ? [] : [{ x: r.time, y, date: r.date }]; });

export function CurveStatus() {
  const { error, loading } = useCurves();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "計算中…" : ""}</p>;
}

/** II-2.2.1: the zero-rate nodes, editable. */
export function NodeEditor() {
  const { ratesPct, setRate, reset, loading, data } = useCurves();
  const tenors = ["0D", "1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y"];
  const dates = ["2022-08-19", "2022-09-19", "2022-11-21", "2023-02-20", "2023-08-21", "2024-08-19", "2025-08-19", "2027-08-19", "2032-08-19"];
  return (
    <div className="table-wrap">
      <table className="data">
        <caption>ゼロ金利ノード（評価日 2022-08-19、連続複利、<strong>例示値</strong>。値を変えると R API がカーブを作り直します）　{data && <Tag d={data} />}</caption>
        <thead><tr><th scope="col">年限</th><th scope="col">日付</th><th scope="col" className="num">ゼロ金利（%）</th></tr></thead>
        <tbody>
          {tenors.map((t, i) => (
            <tr key={t}>
              <th scope="row">{t}</th><td>{dates[i]}</td>
              <td className="num">
                <input type="number" step="0.01" value={ratesPct[i]} aria-label={`${t} のゼロ金利（%）`} className="rate-input"
                  onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) setRate(i, v); }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="controls" role="group" aria-label="ノードの操作">
        <button type="button" onClick={reset} disabled={loading}>初期値に戻す</button>
        <span className="controls-state">{loading ? "再計算中…" : "値を変えると、下の図表が更新されます"}</span>
      </div>
    </div>
  );
}

/** Zero curve at standard tenors. */
export function ZeroCurveTable() {
  return (
    <Need>
      {(d) => (
        <div className="table-wrap">
          <table className="data">
            <caption>Zero curve（ZeroCurve、年限は評価日＋期間の暦日）　<Tag d={d} /></caption>
            <thead><tr><th scope="col">年限</th><th scope="col">日付</th><th scope="col" className="num">割引係数</th><th scope="col" className="num">ゼロ金利（連続複利）</th></tr></thead>
            <tbody>{d.zero_curve.table.map((r) => <tr key={r.tenor}><th scope="row">{r.tenor}</th><td>{r.date}</td><td className="num">{r.discount.toFixed(10)}</td><td className="num">{pctS(r.zero_continuous)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Need>
  );
}

/** Discount factor, zero rate and one-step forward of the zero curve. */
export function ZeroCurveCharts() {
  return (
    <Need>
      {(d) => {
        const p = d.zero_curve.points;
        const one = (key: string, pick: (r: CurvePointRow) => number | null): Series[] => [{ key, label: "ZeroCurve", color: "var(--series-1)", points: pts(p, pick) }];
        const footer = <Tag d={d} />;
        return (
          <div className="chart-grid-3">
            <LineChart title="Discount factor curve（割引係数カーブ）" series={one("df", (r) => r.discount)} origin={d.evaluation_date} xMax={10.1} height={245}
              yLabel="Discount factor" formatY={(y) => y.toFixed(8)} formatTick={(y) => y.toFixed(3)} footer={footer} />
            <LineChart title="Continuous zero-rate curve（連続複利ゼロ金利カーブ）" origin={d.evaluation_date} xMax={10.1} height={245} yLabel="Zero rate (%)"
              series={[{ ...one("zero", (r) => (r.zero_continuous === null ? null : r.zero_continuous * 100))[0],
                dots: d.nodes.filter((n) => n.time > 0).map((n) => ({ x: n.time, y: n.zero_rate * 100, date: n.date })) }]}
              formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => y.toFixed(2)} footer={footer} />
            <LineChart title="One-step forward-rate curve（隣接区間のフォワード金利）" series={one("fwd", (r) => (r.forward_step === null ? null : r.forward_step * 100))}
              origin={d.evaluation_date} xMax={10.1} height={245} yLabel="Forward rate (%)" formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => y.toFixed(2)} footer={footer} />
          </div>
        );
      }}
    </Need>
  );
}

/** The same nodes with two interpolation targets. */
export function InterpolationCharts() {
  return (
    <Need>
      {(d) => {
        const two = (pick: (r: CurvePointRow) => number | null): Series[] => [
          { key: "zero", label: "ZeroCurve（ゼロ金利を線形補間）", color: "var(--series-1)", points: pts(d.zero_curve.points, pick) },
          { key: "disc", label: "DiscountCurve（割引係数を対数線形補間）", color: "var(--series-2)", points: pts(d.discount_curve.points, pick), dashed: true },
        ];
        const footer = <Tag d={d} />;
        return (
          <div className="chart-pair">
            <LineChart title="Zero rates under different interpolation targets" series={two((r) => (r.zero_continuous === null ? null : r.zero_continuous * 100))}
              origin={d.evaluation_date} xMax={10.1} height={250} yLabel="Zero rate (%)" formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => y.toFixed(2)} footer={footer} />
            <LineChart title="Forward rates under different interpolation targets" series={two((r) => (r.forward_step === null ? null : r.forward_step * 100))}
              origin={d.evaluation_date} xMax={10.1} height={250} yLabel="Forward rate (%)" formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => y.toFixed(2)} footer={footer} />
          </div>
        );
      }}
    </Need>
  );
}

/** A parallel shift of the zero curve. */
export function ShiftSection() {
  const { shiftBp, setShiftBp } = useCurves();
  return (
    <>
      <div className="controls" role="group" aria-label="平行シフト">
        <label>平行シフト（bp）{" "}
          <input type="number" step="1" value={shiftBp} aria-label="平行シフト（bp）" className="rate-input"
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) setShiftBp(v); }} />
        </label>
        {[-50, 0, 50, 100].map((v) => <button key={v} type="button" onClick={() => setShiftBp(v)} aria-pressed={shiftBp === v}>{v > 0 ? `+${v}` : v} bp</button>)}
      </div>
      <Need>
        {(d) => {
          const base = d.zero_curve.table;
          const sh = d.shifted_curve.table;
          return (
            <div className="two-col">
              <LineChart title="Parallel shift of the zero curve" origin={d.evaluation_date} xMax={10.1} height={260} yLabel="Continuous zero rate (%)"
                series={[
                  { key: "b", label: "Base curve", color: "var(--series-1)", points: pts(d.zero_curve.points, (r) => (r.zero_continuous === null ? null : r.zero_continuous * 100)) },
                  { key: "s", label: `Base curve ${d.request.shiftBp >= 0 ? "+" : ""}${d.request.shiftBp}bp`, color: "var(--series-2)", dashed: true,
                    points: pts(d.shifted_curve.points, (r) => (r.zero_continuous === null ? null : r.zero_continuous * 100)) },
                ]}
                formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => y.toFixed(2)} footer={<Tag d={d} />} />
              <div className="table-wrap">
                <table className="data">
                  <caption>Parallel curve shift（シフトはゼロ金利に単利・年1回で加算）　<Tag d={d} /></caption>
                  <thead><tr><th scope="col">年限</th><th scope="col">日付</th><th scope="col" className="num">割引係数（基準）</th><th scope="col" className="num">割引係数（シフト後）</th><th scope="col" className="num">ゼロ金利（基準）</th><th scope="col" className="num">ゼロ金利（シフト後）</th><th scope="col" className="num">変化（bp）</th></tr></thead>
                  <tbody>
                    {base.map((r, i) => (
                      <tr key={r.tenor}><th scope="row">{r.tenor}</th><td>{r.date}</td><td className="num">{r.discount.toFixed(8)}</td><td className="num">{sh[i].discount.toFixed(8)}</td>
                        <td className="num">{pctS(r.zero_continuous)}</td><td className="num">{pctS(sh[i].zero_continuous)}</td>
                        <td className="num" data-testid={`shift-bp-${r.tenor}`}>{r.zero_continuous === null || sh[i].zero_continuous === null ? "—" : ((sh[i].zero_continuous! - r.zero_continuous) * 1e4).toFixed(4)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }}
      </Need>
    </>
  );
}

/**
 * Single-node simulation: move one node's zero rate by bp, rebuild the ZeroCurve (rmql), and compare the discount
 * factors, the zero-coupon bond prices (100 x DF) and the zero rates with the base, node by node.
 */
export function NodeSimulation() {
  const { bump, setBump } = useCurves();
  return (
    <>
      <div className="controls" role="group" aria-label="動かすノード">
        <label>年限{" "}
          <select value={bump.tenor} aria-label="動かすノードの年限" data-testid="bump-tenor" onChange={(e) => setBump({ ...bump, tenor: e.target.value })}>
            {NODE_TENORS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>ゼロ金利の変化（bp）{" "}
          <input type="number" step="10" min={-1000} max={1000} value={bump.bp} aria-label="ゼロ金利の変化（bp）" className="rate-input"
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) setBump({ ...bump, bp: Math.max(-1000, Math.min(1000, v)) }); }} />
        </label>
        {[-100, -50, 50, 100].map((v) => <button key={v} type="button" onClick={() => setBump({ ...bump, bp: v })} aria-pressed={bump.bp === v}>{v > 0 ? `+${v}` : v} bp</button>)}
        <button type="button" onClick={() => setBump({ ...bump, bp: 0 })} disabled={bump.bp === 0}>動かさない</button>
      </div>
      <Need>
        {(d) => {
          const b = d.bump;
          if (!b) return <p className="muted">（シミュレーションの結果がありません）</p>;
          const hit = b.table.find((r) => r.is_bumped)!;
          // a value that rounds to zero in the shown digits gets no sign
          const sign = (x: number, n: number) => (Math.abs(x) < 0.5 * 10 ** -n ? (0).toFixed(n) : `${x > 0 ? "+" : ""}${x.toFixed(n)}`);
          const base = d.zero_curve.points, moved = b.points;
          const price = (i: number) => 100 * base[i].discount;
          const series: Series[] = [
            { key: "b", label: "Base curve", color: "var(--series-1)", points: base.map((p, i) => ({ x: p.time, y: price(i), date: p.date })) },
            { key: "s", label: `${b.tenor} ${sign(b.bp, 0)}bp`, color: "var(--series-2)", dashed: true, points: moved.map((p, i) => ({ x: p.time, y: 100 * p.discount, date: base[i].date })) },
          ];
          const diff: Series[] = [{ key: "d", label: "Price change", color: "var(--series-3)", points: moved.map((p, i) => ({ x: p.time, y: 100 * (p.discount - base[i].discount), date: base[i].date })) }];
          return (
            <>
              <p className="muted" data-testid="bump-summary">
                {b.tenor}（{b.node_date} 満期）のゼロクーポン債、額面100の価格：{hit.price_base.toFixed(4)} → {hit.price_bumped.toFixed(4)}
                （{sign(hit.price_change, 4)}、{sign(hit.price_change_pct, 2)}%）。ゼロ金利 {pctS(hit.zero_base)} → {pctS(hit.zero_bumped)}（{sign(b.bp, 0)}bp）。
              </p>
              <div className="two-col">
                <LineChart title="Zero-coupon bond price（額面100）：基準とノードを動かしたあと" origin={d.evaluation_date} xMax={10.1} height={240} yLabel="Price"
                  series={series} formatY={(y) => y.toFixed(4)} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
                <LineChart title="Price change（動かしたあと − 基準、額面100あたり）" origin={d.evaluation_date} xMax={10.1} height={240} yLabel="Price change" zeroLine
                  series={diff} formatY={(y) => y.toFixed(4)} formatTick={(y) => y.toFixed(1)} footer={<Tag d={d} />} />
              </div>
              <div className="table-wrap">
                <table className="data">
                  <caption>ノードを1つだけ動かしたときの変化（補間の行は、ノードから補間された年限）　<Tag d={d} /></caption>
                  <thead><tr><th scope="col">年限</th><th scope="col">日付</th><th scope="col" className="num">ゼロ金利（基準）</th><th scope="col" className="num">ゼロ金利（動かしたあと）</th>
                    <th scope="col" className="num">割引係数（基準）</th><th scope="col" className="num">価格（基準）</th><th scope="col" className="num">価格（動かしたあと）</th>
                    <th scope="col" className="num">価格の変化</th><th scope="col" className="num">変化率</th></tr></thead>
                  <tbody>
                    {b.table.map((r) => (
                      <tr key={`${r.tenor}-${r.date}`} className={r.is_bumped ? "changed" : undefined} data-testid={`bump-row-${r.tenor}`}>
                        <th scope="row">{r.tenor}{r.is_node ? "" : "（補間）"}</th><td>{r.date}</td><td className="num">{pctS(r.zero_base)}</td><td className="num">{pctS(r.zero_bumped)}</td>
                        <td className="num">{r.discount_base.toFixed(6)}</td><td className="num">{r.price_base.toFixed(4)}</td><td className="num">{r.price_bumped.toFixed(4)}</td>
                        <td className="num">{sign(r.price_change, 4)}</td><td className="num">{sign(r.price_change_pct, 2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      </Need>
    </>
  );
}

/** Node recovery and validation. */
export function ValidationTables() {
  return (
    <Need>
      {(d) => (
        <div className="two-col">
          <div className="table-wrap">
            <table className="data">
              <caption>Node recovery check（ノードのゼロ金利の再現）　<Tag d={d} /></caption>
              <thead><tr><th scope="col">年限</th><th scope="col">日付</th><th scope="col" className="num">入力</th><th scope="col" className="num">ZeroCurve</th><th scope="col" className="num">DiscountCurve</th><th scope="col" className="num">誤差（ZeroCurve）</th><th scope="col" className="num">誤差（DiscountCurve）</th></tr></thead>
              <tbody>{d.node_recovery.map((r) => (
                <tr key={r.tenor}><th scope="row">{r.tenor}</th><td>{r.date}</td><td className="num">{pctS(r.zero_rate)}</td><td className="num">{pctS(r.zero_curve_implied_rate)}</td><td className="num">{pctS(r.discount_curve_implied_rate)}</td>
                  <td className="num">{r.zero_curve_error.toExponential(1)}</td><td className="num">{r.discount_curve_error.toExponential(1)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table className="data">
              <caption>Curve validation summary（301点のグリッド）</caption>
              <thead><tr><th scope="col">カーブ</th><th scope="col">最初の日付</th><th scope="col">最後の日付</th><th scope="col" className="num">最小の割引係数</th><th scope="col" className="num">最大の割引係数</th><th scope="col" className="num">非正の割引係数</th><th scope="col" className="num">欠損（割引係数）</th><th scope="col" className="num">欠損（ゼロ金利）</th></tr></thead>
              <tbody>{d.validation.map((v) => (
                <tr key={v.curve}><th scope="row">{v.curve}</th><td>{v.first_date}</td><td>{v.last_date}</td><td className="num">{v.min_discount.toFixed(8)}</td><td className="num">{v.max_discount.toFixed(8)}</td>
                  <td className="num">{v.nonpositive_discount_count}</td><td className="num">{v.missing_discount_count}</td><td className="num">{v.missing_zero_rate_count}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </Need>
  );
}
