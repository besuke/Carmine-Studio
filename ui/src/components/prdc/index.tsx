import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchPrdc, type McInputs, type NoteInputs, type PrdcResponse } from "../../api/prdc";
import { LineChart } from "../LineChart";
import { FlowChart } from "../FlowChart";

// Components of the PRDC chapter (Coral-Book II-9). The reader moves the FX market, the coupon's terms and the
// Monte Carlo settings; each change asks the R API.

type Req = { note: NoteInputs; mc: McInputs };
type Section = keyof Req;
const DEFAULT: Req = {
  note: { spot: 133.2681, volPct: 10, domesticPct: 1, foreignPct: 3, discountPct: 0.5, fxBase: 120, leveragePct: 12.2, subtractionPct: 10, floorPct: 0, capPct: 2.2 },
  mc: { paths: 3000, seed: 123 },
};

interface PState {
  data: PrdcResponse | null; loading: boolean; error: string | null; req: Req;
  set: <S extends Section>(s: S, p: Partial<Req[S]>) => void; reset: (s: Section) => void;
}
const Ctx = createContext<PState | null>(null);

export function PrdcProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState(DEFAULT);
  const [data, setData] = useState<PrdcResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchPrdc(req, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 300);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [req]);
  const value: PState = {
    data, loading, error, req,
    set: (s, p) => setReq((x) => ({ ...x, [s]: { ...x[s], ...p } })),
    reset: (s) => setReq((x) => ({ ...x, [s]: DEFAULT[s] })),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
function useP(): PState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useP must be used inside PrdcProvider");
  return s;
}
function Need({ children }: { children: (d: PrdcResponse) => ReactNode }) {
  const { data, error } = useP();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（直前の入力では計算できません。値を戻してください）</p>;
  return <p className="muted">計算中…</p>;
}
const Tag = ({ d }: { d: PrdcResponse }) => <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>;
const f = (x: number, n: number) => x.toFixed(n);
const pct = (x: number, n = 2) => `${f(x * 100, n)}%`;
const yen = (x: number) => Math.round(x).toLocaleString("ja-JP");

export function PrdcStatus() {
  const { error, loading } = useP();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "計算中…" : ""}</p>;
}

type Field = { key: string; label: string; step: number; min: number; max: number };
const MARKET: Field[] = [
  { key: "spot", label: "FX スポット（円）", step: 1, min: 50, max: 250 },
  { key: "volPct", label: "FX ボラ（%）", step: 0.5, min: 1, max: 50 },
  { key: "domesticPct", label: "円金利（%）", step: 0.25, min: -2, max: 10 },
  { key: "foreignPct", label: "外貨金利（%）", step: 0.25, min: -2, max: 15 },
  { key: "discountPct", label: "割引金利（%）", step: 0.25, min: -2, max: 10 },
];
const TERMS: Field[] = [
  { key: "fxBase", label: "基準 FX", step: 1, min: 50, max: 250 },
  { key: "leveragePct", label: "レバレッジ a（%）", step: 0.1, min: 0.1, max: 50 },
  { key: "subtractionPct", label: "控除 b（%）", step: 0.5, min: 0, max: 50 },
  { key: "floorPct", label: "フロア（%）", step: 0.1, min: 0, max: 10 },
  { key: "capPct", label: "キャップ（%）", step: 0.1, min: 0, max: 20 },
];

function Inputs({ fields, label }: { fields: Field[]; label: string }) {
  const { req, set } = useP();
  return (
    <>
      {fields.map((fd) => (
        <label key={fd.key}>{fd.label}{" "}
          <input type="number" step={fd.step} min={fd.min} max={fd.max} className="rate-input" aria-label={`${label}：${fd.label}`}
            value={(req.note as unknown as Record<string, number>)[fd.key]}
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set("note", { [fd.key]: v } as never); }} />
        </label>
      ))}
    </>
  );
}

export function PrdcControls({ which }: { which: "market" | "terms" | "mc" }) {
  const { req, set, reset, loading, data, error } = useP();
  return (
    <div className="controls" role="group" aria-label={which === "market" ? "FX 市場の前提" : which === "terms" ? "クーポンの条件" : "モンテカルロの設定"} data-section={which}>
      {which === "market" && <Inputs fields={MARKET} label="FX 市場" />}
      {which === "terms" && <Inputs fields={TERMS} label="クーポン" />}
      {which === "mc" && (
        <>
          <label>パス数{" "}
            <select value={req.mc.paths} aria-label="モンテカルロ：パス数" onChange={(e) => set("mc", { paths: Number(e.target.value) })}>
              {[300, 1000, 3000, 10000, 30000, 100000].map((n) => <option key={n} value={n}>{n.toLocaleString("ja-JP")}</option>)}
            </select>
          </label>
          <label>seed{" "}
            <input type="number" step={1} min={1} className="rate-input" aria-label="モンテカルロ：seed" value={req.mc.seed}
              onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isInteger(v) && v >= 1) set("mc", { seed: v }); }} />
          </label>
        </>
      )}
      <button type="button" onClick={() => reset(which === "mc" ? "mc" : "note")}>初期値に戻す</button>
      <span className="controls-state">{loading ? "再計算中…" : error ? <span className="error-text">{error}</span> : data ? <Tag d={data} /> : null}</span>
    </div>
  );
}

/** II-9.1: schedule status and the curves. */
export function TermsPanel() {
  return (
    <Need>
      {(d) => {
        const n = d.note, sc = n.schedule;
        return (
          <div className="table-wrap">
            <table className="data">
              <caption>PRDC の条件と市場の前提（評価日 {n.valuation_date}、想定元本 {yen(n.notional)} 円）　<Tag d={d} /></caption>
              <tbody>
                <tr><th scope="row">クーポン日（全体・評価日より後）</th><td className="num" data-testid="remaining">{sc.total_dates} 日・{sc.remaining} 日</td></tr>
                <tr><th scope="row">導入期間の固定クーポン {pct(sc.intro_rate, 1)}（日数・評価日より後）</th><td className="num">{sc.intro_dates} 日・{sc.intro_remaining} 日</td></tr>
                <tr><th scope="row">FX のリスク中立ドリフト（円金利 − 外貨金利）</th><td className="num">{pct(n.drift, 2)}</td></tr>
                <tr><th scope="row">割引金利</th><td className="num">{pct(n.domestic_curve_rate, 2)}</td></tr>
                <tr><th scope="row">クーポンがフロア・キャップになる FX</th><td className="num">{f(n.thresholds.floor_fx, 4)} 円 ・ {f(n.thresholds.cap_fx, 4)} 円</td></tr>
              </tbody>
            </table>
          </div>
        );
      }}
    </Need>
  );
}

/** II-9.2.2: the coupon against the FX rate. */
export function PayoffChart() {
  return (
    <Need>
      {(d) => {
        const n = d.note;
        const pt = (k: "coupon_rate" | "uncapped_coupon") => n.payoff.map((r) => ({ x: r.fx_rate, y: 100 * r[k], date: `FX ${r.fx_rate} 円` }));
        return (
          <LineChart title="PRDC クーポンのペイオフ：フロアとキャップのある FX 連動クーポン" origin="2026-01-01" xMin={70} xMax={180}
            xTicks={[70, 90, 110, 130, 150, 170].map((x) => ({ x, label: String(x) }))} xLabel="FX（円／外貨）" yLabel="クーポン（%）"
            series={[{ key: "c", label: "クーポン", color: "var(--series-1)", points: pt("coupon_rate") },
              { key: "u", label: "キャップ・フロアなし", color: "var(--text-muted)", dashed: true, points: pt("uncapped_coupon") }]}
            markers={[{ x: n.thresholds.floor_fx, label: "フロア" }, { x: n.thresholds.cap_fx, label: "キャップ" }, { x: n.thresholds.spot, label: "スポット" }]}
            formatY={(y) => `${y.toFixed(3)}%`} formatTick={(y) => `${y.toFixed(1)}%`} footer={<Tag d={d} />} />
        );
      }}
    </Need>
  );
}

/** II-9.3.2: sample FX paths. */
export function SamplePathsChart() {
  return (
    <Need>
      {(d) => {
        const n = d.note;
        const series = n.sample_paths.map((p, i) => ({
          key: `p${i}`, label: i === 0 ? `FX（${n.sample_paths.length}本）` : `パス ${i + 1}`, inLegend: i === 0, color: "var(--series-1)", strokeWidth: 1, opacity: 0.6,
          points: p.map((y, k) => ({ x: n.sample_times[k], y, date: `${f(n.sample_times[k], 2)} 年` })),
        }));
        const tMax = n.sample_times[n.sample_times.length - 1];
        return (
          <LineChart title={`FX のサンプルパス（${n.sample_paths.length}本、ドリフト ${pct(n.drift, 1)}／年）`} origin="2026-01-01" xMin={0} xMax={tMax}
            xTicks={[0, 5, 10, 15].map((x) => ({ x, label: String(x) }))} xLabel="評価日からの年数" yLabel="FX（円）" tooltipRows={3}
            series={series} formatY={(y) => y.toFixed(2)} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
        );
      }}
    </Need>
  );
}

/** II-9.3.3: the value in closed form and by Monte Carlo. */
export function ValuePanel() {
  return (
    <Need>
      {(d) => {
        const c = d.note.closed, m = d.mc;
        const lp = (x: number) => Math.log10(x);
        return (
          <>
            <div className="tiles">
              <div className="tile emphasis"><div className="tile-label">PRDC の現在価値</div><div className="tile-value" data-testid="npv">{yen(c.npv)} 円</div>
                <div className="tile-note">想定元本の {pct(c.npv / d.note.notional, 3)}</div></div>
              <div className="tile"><div className="tile-label">クーポンレッグ ／ 元本の償還</div><div className="tile-value tile-small">{yen(c.coupon_leg_pv)} ／ {yen(c.redemption_pv)}</div></div>
              <div className="tile"><div className="tile-label">FX デルタ（1円あたり）</div><div className="tile-value" data-testid="delta">{yen(c.fx_delta)} 円</div>
                <div className="tile-note">ベガ（ボラ 1% あたり）{yen(c.fx_vega / 100)} 円</div></div>
            </div>
            <div className="table-wrap">
              <table className="data">
                <caption>モンテカルロでの確認（{m.paths.toLocaleString("ja-JP")} 本、seed {m.seed}）　<Tag d={d} /></caption>
                <thead><tr><th scope="col">方法</th><th scope="col" className="num">現在価値（円）</th><th scope="col" className="num">標準誤差（円）</th><th scope="col" className="num">差 ÷ 標準誤差</th></tr></thead>
                <tbody>
                  <tr><th scope="row">閉じた式</th><td className="num">{yen(c.npv)}</td><td className="num">—</td><td className="num">—</td></tr>
                  <tr><th scope="row">モンテカルロ</th><td className="num" data-testid="mc-npv">{yen(m.npv)}</td><td className="num">{yen(m.standard_error)}</td>
                    <td className="num">{f((m.npv - c.npv) / m.standard_error, 2)}</td></tr>
                </tbody>
              </table>
            </div>
            <LineChart title="パス数とモンテカルロの現在価値（横軸は対数目盛、帯は ±2 標準誤差）" origin="2026-01-01" xMin={lp(300)} xMax={lp(30000)}
              xTicks={[300, 1000, 3000, 10000, 30000].map((x) => ({ x: lp(x), label: x.toLocaleString("ja-JP") }))} xLabel="パス数" yLabel="現在価値（百万円）"
              series={[
                { key: "mc", label: "モンテカルロ", color: "var(--series-1)", points: m.by_paths.map((r) => ({ x: lp(r.paths), y: r.npv / 1e6, date: `${r.paths} 本` })), dots: m.by_paths.map((r) => ({ x: lp(r.paths), y: r.npv / 1e6, date: `${r.paths} 本` })) },
                { key: "hi", label: "+2 標準誤差", color: "var(--text-muted)", dashed: true, points: m.by_paths.map((r) => ({ x: lp(r.paths), y: (r.npv + 2 * r.standard_error) / 1e6, date: `${r.paths} 本` })) },
                { key: "lo", label: "−2 標準誤差", color: "var(--text-muted)", dashed: true, inLegend: false, points: m.by_paths.map((r) => ({ x: lp(r.paths), y: (r.npv - 2 * r.standard_error) / 1e6, date: `${r.paths} 本` })) },
                { key: "cf", label: "閉じた式", color: "var(--series-2)", points: [{ x: lp(300), y: c.npv / 1e6, date: "閉じた式" }, { x: lp(30000), y: c.npv / 1e6, date: "閉じた式" }] },
              ]}
              formatY={(y) => y.toFixed(3)} formatTick={(y) => y.toFixed(1)} footer={<Tag d={d} />} />
          </>
        );
      }}
    </Need>
  );
}

/** Expected coupons and the probabilities of the floor and the cap. */
export function CouponTermPanel() {
  return (
    <Need>
      {(d) => {
        const cs = d.note.coupons;
        const pt = (k: "expected_coupon_rate" | "coupon_at_expected_fx") => cs.map((r) => ({ x: r.time, y: 100 * r[k], date: r.coupon_date }));
        const pp = (k: "floor_probability" | "cap_probability") => cs.map((r) => ({ x: r.time, y: 100 * r[k], date: r.coupon_date }));
        const tMax = cs[cs.length - 1].time;
        return (
          <>
            <div className="chart-pair">
              <LineChart title="期待クーポンの期間構造：E[C(S)] と、期待 FX をクーポン式に入れた C(E[S])" origin="2026-01-01" xMin={0} xMax={tMax}
                xTicks={[0, 5, 10, 15].map((x) => ({ x, label: String(x) }))} xLabel="評価日からの年数" yLabel="クーポン（%）"
                series={[{ key: "e", label: "期待クーポン E[C(S)]", color: "var(--series-1)", points: pt("expected_coupon_rate"), dots: pt("expected_coupon_rate") },
                  { key: "c", label: "C(E[S])", color: "var(--series-2)", dashed: true, points: pt("coupon_at_expected_fx") }]}
                formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => `${y.toFixed(1)}%`} footer={<Tag d={d} />} />
              <LineChart title="クーポンがフロア・キャップになる確率" origin="2026-01-01" xMin={0} xMax={tMax}
                xTicks={[0, 5, 10, 15].map((x) => ({ x, label: String(x) }))} xLabel="評価日からの年数" yLabel="確率（%）"
                series={[{ key: "f", label: "フロア（クーポン 0%）", color: "var(--series-1)", points: pp("floor_probability") },
                  { key: "c", label: "キャップ（クーポン上限）", color: "var(--series-2)", points: pp("cap_probability") }]}
                formatY={(y) => `${y.toFixed(2)}%`} formatTick={(y) => `${y.toFixed(0)}%`} footer={<Tag d={d} />} />
            </div>
            <details>
              <summary>期待クーポンとキャッシュフローの表（{cs.length} 日）を開く</summary>
              <div className="table-wrap">
                <table className="data">
                  <caption>PRDC の期待 FX・期待クーポンとキャッシュフロー（円）　<Tag d={d} /></caption>
                  <thead><tr><th scope="col" className="num">#</th><th scope="col">クーポン日</th><th scope="col" className="num">年数</th><th scope="col" className="num">期待 FX</th>
                    <th scope="col" className="num">期待クーポン</th><th scope="col" className="num">フロア確率</th><th scope="col" className="num">キャップ確率</th>
                    <th scope="col" className="num">クーポン額</th><th scope="col" className="num">割引係数</th><th scope="col" className="num">現在価値</th></tr></thead>
                  <tbody>{cs.map((r) => (
                    <tr key={r.coupon_number}><th scope="row" className="num">{r.coupon_number}</th><td>{r.coupon_date}</td><td className="num">{f(r.time, 3)}</td><td className="num">{f(r.expected_fx, 3)}</td>
                      <td className="num">{pct(r.expected_coupon_rate, 4)}</td><td className="num">{pct(r.floor_probability, 2)}</td><td className="num">{pct(r.cap_probability, 2)}</td>
                      <td className="num">{yen(r.total_amount)}</td><td className="num">{f(r.discount_factor, 6)}</td><td className="num">{yen(r.total_present_value)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          </>
        );
      }}
    </Need>
  );
}

/** The coupon's distribution on the first, a middle and the last coupon date. */
export function DistributionCharts() {
  return (
    <Need>
      {(d) => {
        const ids = [...new Set(d.note.distribution.map((r) => r.coupon_number))];
        const cap = d.inputs.note.capPct, floor = d.inputs.note.floorPct;
        return (
          <div className="chart-grid-3">
            {ids.map((id) => {
              const rows = d.note.distribution.filter((r) => r.coupon_number === id);
              const between = rows.filter((r) => r.kind === "between");
              const w = between[0].upper - between[0].lower;
              const pad = w * 100 * 1.5;
              const bars = rows.map((r) => ({
                x: r.kind === "between" ? 100 * (r.lower + r.upper) / 2 : 100 * r.lower, value: 100 * r.probability,
                series: r.kind, date: r.kind === "between" ? `${f(100 * r.lower, 3)}%〜${f(100 * r.upper, 3)}%` : r.kind === "floor" ? "フロア" : "キャップ", label: "確率",
              }));
              return (
                <FlowChart key={id} title={`クーポンの分布：${rows[0].coupon_date}（${id}回目）`} origin="2026-01-01" xMin={floor - pad} xMax={cap + pad}
                  xTicks={[floor, (floor + cap) / 2, cap].map((x) => ({ x, label: `${Number(x.toFixed(2))}%` }))} barWidth={100 * w} yLabel="確率（%）" legend
                  series={[{ key: "floor", label: "フロア", color: "var(--series-1)" }, { key: "between", label: "その間", color: "var(--series-3)" }, { key: "cap", label: "キャップ", color: "var(--series-2)" }]}
                  bars={bars} formatY={(y) => `${y.toFixed(1)}%`} footer={<Tag d={d} />} />
              );
            })}
          </div>
        );
      }}
    </Need>
  );
}

/** II-9.5: FX spot and volatility. */
export function SensitivityPanel() {
  return (
    <Need>
      {(d) => {
        const n = d.note;
        const sp = n.spot_curve.map((r) => ({ x: r.fx_spot, y: r.npv / 1e6, date: `スポット ${r.fx_spot} 円` }));
        const sd = n.spot_scenarios.map((r) => ({ x: r.fx_spot, y: r.npv / 1e6, date: r.scenario }));
        return (
          <>
            <LineChart title="FX スポットと PRDC の現在価値" origin="2026-01-01" xMin={n.spot_curve[0].fx_spot} xMax={n.spot_curve[n.spot_curve.length - 1].fx_spot}
              xTicks={n.spot_curve.filter((_, i) => i % 10 === 0).map((r) => ({ x: r.fx_spot, label: String(r.fx_spot) }))} xLabel="FX スポット（円）" yLabel="現在価値（百万円）"
              series={[{ key: "v", label: "現在価値", color: "var(--series-1)", points: sp, dots: sd }]}
              markers={[{ x: n.thresholds.floor_fx, label: "フロア" }, { x: n.thresholds.cap_fx, label: "キャップ" }]}
              formatY={(y) => y.toFixed(3)} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
            <div className="chart-pair">
              <div className="table-wrap">
                <table className="data">
                  <caption>FX スポット感応度（円）　<Tag d={d} /></caption>
                  <thead><tr><th scope="col">シナリオ</th><th scope="col" className="num">スポット</th><th scope="col" className="num">現在価値</th><th scope="col" className="num">基準との差</th></tr></thead>
                  <tbody>{n.spot_scenarios.map((r) => (
                    <tr key={r.scenario}><th scope="row">{r.scenario}</th><td className="num">{f(r.fx_spot, 4)}</td><td className="num">{yen(r.npv)}</td><td className="num">{yen(r.npv - n.closed.npv)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <caption>FX ボラティリティ感応度（円）</caption>
                  <thead><tr><th scope="col">シナリオ</th><th scope="col" className="num">ボラ</th><th scope="col" className="num">現在価値</th><th scope="col" className="num">基準との差</th></tr></thead>
                  <tbody>{n.vol_scenarios.map((r) => (
                    <tr key={r.scenario}><th scope="row">{r.scenario}</th><td className="num">{pct(r.fx_volatility, 1)}</td><td className="num" data-testid={`vol-${r.scenario}`}>{yen(r.npv)}</td><td className="num">{yen(r.npv - n.closed.npv)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </>
        );
      }}
    </Need>
  );
}
