import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchCds, type CdsCashflow, type CdsHand, type CdsInputs, type CdsResponse, type CdsValue } from "../../api/cds";
import { LineChart } from "../LineChart";

// Components of the credit risk and CDS chapter (Coral-Book II-5). The reader moves the market spread, the
// contract coupon, the recovery rate and the discount rate of the one-year swap and of the standard five-year swap;
// each change asks the R API (rmql).

type Section = "flat" | "isda";
const DEFAULT: Record<Section, CdsInputs> = {
  flat: { spreadBp: 130, couponBp: 100, recoveryPct: 40, ratePct: 10 },
  isda: { spreadBp: 30.426, couponBp: 100, recoveryPct: 40, ratePct: 0.25 },
};

interface CState {
  data: CdsResponse | null; loading: boolean; error: string | null;
  req: Record<Section, CdsInputs>; set: (s: Section, p: Partial<CdsInputs>) => void; reset: (s: Section) => void;
}
const Ctx = createContext<CState | null>(null);

export function CdsProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState(DEFAULT);
  const [data, setData] = useState<CdsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchCds(req, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 250);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [req]);
  const value: CState = {
    data, loading, error, req,
    set: (s, p) => setReq((x) => ({ ...x, [s]: { ...x[s], ...p } })),
    reset: (s) => setReq((x) => ({ ...x, [s]: DEFAULT[s] })),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
function useC(): CState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useC must be used inside CdsProvider");
  return s;
}
function Need({ children }: { children: (d: CdsResponse) => ReactNode }) {
  const { data, error } = useC();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（R APIの応答がないため表示できません）</p>;
  return <p className="muted">計算中…</p>;
}
const Tag = ({ d }: { d: CdsResponse }) => <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>;
const f = (x: number, n: number) => x.toFixed(n);
const yen = (x: number) => x.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x: number, n = 4) => `${f(x * 100, n)}%`;
const bp = (x: number, n = 4) => `${f(x * 1e4, n)} bp`;
const opt = (x: number | null, fmt: (v: number) => string) => (x == null ? "—" : fmt(x));

export function CdsStatus() {
  const { error, loading } = useC();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "計算中…" : ""}</p>;
}

const FIELDS: { key: keyof CdsInputs; label: string; step: number; min: number; max: number }[] = [
  { key: "spreadBp", label: "市場 Spread（bp）", step: 1, min: 1, max: 1000 },
  { key: "couponBp", label: "契約 Coupon（bp）", step: 25, min: 0, max: 1000 },
  { key: "recoveryPct", label: "Recovery Rate（%）", step: 5, min: 0, max: 80 },
  { key: "ratePct", label: "割引率（%）", step: 0.25, min: -1, max: 20 },
];

/** Inputs of one example; `which` picks the one-year swap or the standard swap. */
export function CdsControls({ which }: { which: Section }) {
  const { req, set, reset, loading, data } = useC();
  const p = req[which];
  const name = which === "flat" ? "1年物" : "標準5年物";
  return (
    <div className="controls" role="group" aria-label={`${name}の前提`} data-section={which}>
      {FIELDS.map((fd) => (
        <label key={fd.key}>{fd.label}{" "}
          <input type="number" step={fd.step} min={fd.min} max={fd.max} value={p[fd.key]} className="rate-input" aria-label={`${name}：${fd.label}`}
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set(which, { [fd.key]: v }); }} />
        </label>
      ))}
      <button type="button" onClick={() => reset(which)}>初期値に戻す</button>
      <span className="controls-state">{loading ? "再計算中…" : data ? <Tag d={data} /> : null}</span>
    </div>
  );
}

/** Flat-hazard survival and cumulative default probabilities. */
export function FlatProbabilityChart() {
  return (
    <Need>
      {(d) => {
        const c = d.flat.probability_curve;
        const pts = (k: "survival_probability" | "default_probability") => c.map((r) => ({ x: r.time, y: r[k] * 100, date: `${r.time}年` }));
        return (
          <div className="two-col">
            <LineChart title={`Flat-hazard survival and default probabilities（λ ≈ s/(1−R) = ${pct(d.flat.hazard_approx)}）`} origin={d.flat.trade_date} xMin={0} xMax={5}
              xLabel="Time (years)" yLabel="Probability (%)" xTicks={[0, 1, 2, 3, 4, 5].map((x) => ({ x, label: String(x) }))}
              series={[
                { key: "q", label: "survival_probability", color: "var(--series-1)", points: pts("survival_probability") },
                { key: "pd", label: "cumulative_default_probability", color: "var(--series-2)", dashed: true, points: pts("default_probability") },
              ]}
              formatY={(y) => `${y.toFixed(2)}%`} formatTick={(y) => `${y.toFixed(0)}%`} footer={<Tag d={d} />} />
            <div className="table-wrap">
              <table className="data">
                <caption>Flat hazard-rate approximation と、カーブの確認（満期 {d.flat.maturity_date}）</caption>
                <tbody>
                  <tr><th scope="row">market_spread</th><td className="num">{bp(d.flat.spread, 3)}</td></tr>
                  <tr><th scope="row">recovery_rate</th><td className="num">{pct(d.flat.recovery, 1)}</td></tr>
                  <tr><th scope="row">loss_given_default</th><td className="num">{pct(1 - d.flat.recovery, 1)}</td></tr>
                  <tr><th scope="row">hazard_rate_approx</th><td className="num" data-testid="flat-hazard-approx">{pct(d.flat.hazard_approx, 6)}</td></tr>
                  <tr><th scope="row">discount_factor_at_maturity</th><td className="num">{f(d.flat.discount_at_maturity, 10)}</td></tr>
                  <tr><th scope="row">survival_probability_at_maturity</th><td className="num">{f(d.flat.survival_at_maturity, 10)}</td></tr>
                  <tr><th scope="row">default_probability_to_maturity</th><td className="num">{f(1 - d.flat.survival_at_maturity, 10)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      }}
    </Need>
  );
}

function ValueTiles({ v, testid, rebate }: { v: CdsValue; testid: string; rebate?: boolean }) {
  return (
    <div className="tiles">
      <div className="tile emphasis"><div className="tile-label">CDS NPV（プロテクション買い手）</div><div className="tile-value" data-testid={`${testid}-npv`}>{yen(v.npv)}</div>
        <div className="tile-note">= Coupon Leg {yen(v.coupon_leg_npv)} ＋ Default Leg {yen(v.default_leg_npv)}{rebate ? ` ＋ Accrual Rebate ${yen(v.accrual_rebate_npv)}` : ""}</div></div>
      <div className="tile"><div className="tile-label">Fair Spread</div><div className="tile-value" data-testid={`${testid}-fair-spread`}>{bp(v.fair_spread)}</div>
        <div className="tile-note">Upfront なしで NPV をゼロにする Running Spread</div></div>
      <div className="tile"><div className="tile-label">Fair Upfront（Notional 比）</div><div className="tile-value">{pct(v.fair_upfront)}</div>
        <div className="tile-note">契約 Coupon のまま、開始時の授受で価値をゼロにする</div></div>
    </div>
  );
}

/** II-5.2.4: the MidPoint value of the one-year swap and the two-leg check. */
export function FlatValuePanel() {
  return (
    <Need>
      {(d) => {
        const v = d.flat.value;
        return (
          <>
            <ValueTiles v={v} testid="flat" />
            <div className="table-wrap">
              <table className="data">
                <caption>CDS two-leg NPV check（MidPoint Engine、契約 Coupon {bp(d.flat.coupon, 1)}）　<Tag d={d} /></caption>
                <tbody>
                  <tr><th scope="row">coupon_leg_npv</th><td className="num">{yen(v.coupon_leg_npv)}</td></tr>
                  <tr><th scope="row">default_leg_npv</th><td className="num">{yen(v.default_leg_npv)}</td></tr>
                  <tr><th scope="row">sum_of_two_legs</th><td className="num">{yen(v.coupon_leg_npv + v.default_leg_npv)}</td></tr>
                  <tr><th scope="row">reported_npv</th><td className="num">{yen(v.npv)}</td></tr>
                  <tr><th scope="row">difference</th><td className="num">{(v.npv - (v.coupon_leg_npv + v.default_leg_npv)).toExponential(3)}</td></tr>
                </tbody>
              </table>
            </div>
          </>
        );
      }}
    </Need>
  );
}

/** II-5.2.5 and II-5.6.4: the cash-flow and probability table. */
export function CashflowTable({ which }: { which: Section }) {
  return (
    <Need>
      {(d) => {
        const rows: CdsCashflow[] = d[which].cashflows;
        return (
          <div className="table-wrap">
            <table className="data">
              <caption>{which === "flat" ? "CDS cash-flow and probability table（1年物）" : "CDS cash-flow table: CDS2015 example（標準5年物、ISDA 整合 Hazard）"}　<Tag d={d} /></caption>
              <thead><tr><th scope="col">支払日</th><th scope="col">期間の開始</th><th scope="col" className="num">日数</th><th scope="col" className="num">Coupon 額</th>
                <th scope="col" className="num">割引係数</th><th scope="col" className="num">生存確率</th><th scope="col" className="num">期間のデフォルト確率</th>
                <th scope="col">中点</th><th scope="col" className="num">中点の割引係数</th><th scope="col" className="num">中点の生存確率</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.payment_date}>
                  <th scope="row">{r.payment_date}</th><td>{r.accrual_start ?? "（Protection 開始）"}</td><td className="num">{opt(r.accrual_days, (x) => String(x))}</td>
                  <td className="num">{opt(r.coupon_amount, yen)}</td><td className="num">{f(r.discount_factor, 8)}</td><td className="num">{f(r.survival_probability, 8)}</td>
                  <td className="num">{f(r.default_probability, 8)}</td><td>{r.midpoint_date ?? "—"}</td>
                  <td className="num">{opt(r.midpoint_discount_factor, (x) => f(x, 8))}</td><td className="num">{opt(r.midpoint_survival_probability, (x) => f(x, 8))}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        );
      }}
    </Need>
  );
}

/** II-5.3.3 and II-5.6.5: the hand calculation from the table against the engine. */
export function HandCheckTable({ which }: { which: Section }) {
  return (
    <Need>
      {(d) => {
        const h: CdsHand = d[which].hand;
        const v: CdsValue = which === "flat" ? d.flat.value : d.isda.isda;
        const engine = which === "flat" ? "MidPoint Engine" : "ISDA Engine";
        const rows: [string, number, number, (x: number) => string][] = [
          ["coupon_leg_npv", h.coupon_leg_npv, v.coupon_leg_npv, yen],
          ["default_leg_npv", h.default_leg_npv, v.default_leg_npv, yen],
          ["cds_npv", h.npv, v.npv, yen],
          ["fair_spread", h.fair_spread, v.fair_spread, (x) => bp(x)],
        ];
        return (
          <div className="table-wrap">
            <table className="data">
              <caption>{which === "flat" ? "CDS hand calculation and MidPoint engine comparison" : "MidPoint-style approximation and ISDA comparison"}
                （Risky PV01 {f(h.risky_pv01, 8)}、単位 Notional の Protection Leg {f(h.protection_leg_per_unit, 8)}）</caption>
              <thead><tr><th scope="col">項目</th><th scope="col" className="num">手計算（表から）</th><th scope="col" className="num">{engine}</th><th scope="col" className="num">差</th></tr></thead>
              <tbody>{rows.map(([k, a, b, fmt]) => (
                <tr key={k}><th scope="row">{k}</th><td className="num">{fmt(a)}</td><td className="num">{fmt(b)}</td>
                  <td className="num">{k === "fair_spread" ? bp(a - b) : yen(a - b)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        );
      }}
    </Need>
  );
}

/** II-5.4.1: the flat hazard rate at zero NPV of the market-spread swap. */
export function CalibrationTable() {
  return (
    <Need>
      {(d) => (
        <div className="table-wrap">
          <table className="data">
            <caption>Flat hazard calibration from a zero-NPV CDS（市場 Spread {bp(d.flat.spread, 3)} を Coupon とする1年物）　<Tag d={d} /></caption>
            <tbody>
              <tr><th scope="row">simple_hazard_approximation</th><td className="num">{pct(d.flat.hazard_approx, 6)}</td></tr>
              <tr><th scope="row">calibrated_hazard_rate</th><td className="num" data-testid="flat-hazard-calibrated">{pct(d.flat.calibration.hazard, 6)}</td></tr>
              <tr><th scope="row">差（calibrated − approx）</th><td className="num">{bp(d.flat.calibration.hazard - d.flat.hazard_approx, 3)}</td></tr>
              <tr><th scope="row">zero_npv_check</th><td className="num">{d.flat.calibration.npv.toExponential(3)}</td></tr>
              <tr><th scope="row">fair_spread_check</th><td className="num">{bp(d.flat.calibration.fair_spread)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </Need>
  );
}

/** II-5.4.2: the spread and recovery grid. */
export function SensitivityTable() {
  return (
    <Need>
      {(d) => (
        <div className="table-wrap">
          <table className="data">
            <caption>Spread and recovery-rate sensitivity（右端の列は、この表の各 Spread を Coupon とする1年物のゼロ NPV Hazard。割引率 {pct(d.flat.rate, 2)}）</caption>
            <thead><tr><th scope="col" className="num">Spread（bp）</th><th scope="col" className="num">Recovery</th><th scope="col" className="num">LGD</th><th scope="col" className="num">λ ≈ s/(1−R)</th>
              <th scope="col" className="num">5年生存確率</th><th scope="col" className="num">5年累積デフォルト確率</th><th scope="col" className="num">ゼロ NPV の λ</th></tr></thead>
            <tbody>{d.sensitivity.map((r) => (
              <tr key={`${r.market_spread_bp}-${r.recovery}`}><th scope="row" className="num">{r.market_spread_bp}</th><td className="num">{pct(r.recovery, 0)}</td><td className="num">{pct(r.loss_given_default, 0)}</td>
                <td className="num">{pct(r.hazard_approx)}</td><td className="num">{pct(r.survival_probability_5y, 3)}</td><td className="num">{pct(r.default_probability_5y, 3)}</td>
                <td className="num">{pct(r.hazard_calibrated)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Need>
  );
}

/** II-5.5.1–5.5.4: the standard swap's maturity, schedule, discount curve and implied hazard. */
export function IsdaSetupPanel() {
  return (
    <Need>
      {(d) => {
        const s = d.isda;
        return (
          <>
            <div className="table-wrap">
              <table className="data">
                <caption>ISDA CDS input assumptions と implied hazard-rate check　<Tag d={d} /></caption>
                <tbody>
                  <tr><th scope="row">trade_date</th><td className="num">{s.trade_date}</td></tr>
                  <tr><th scope="row">cds_tenor / maturity_date（CDS2015）</th><td className="num" data-testid="isda-maturity">5Y → {s.maturity_date}</td></tr>
                  <tr><th scope="row">ois_discount_rate / discount_factor_at_maturity</th><td className="num">{pct(s.rate, 3)} / {f(s.discount_at_maturity, 10)}</td></tr>
                  <tr><th scope="row">market_spread / recovery_rate</th><td className="num">{bp(s.spread, 3)} / {pct(s.recovery, 1)}</td></tr>
                  <tr><th scope="row">implied_hazard_rate（ISDA でゼロ NPV）</th><td className="num" data-testid="isda-hazard">{pct(s.hazard, 6)}</td></tr>
                  <tr><th scope="row">simple_hazard_approximation</th><td className="num">{pct(s.hazard_approx, 6)}</td></tr>
                  <tr><th scope="row">survival_probability_at_maturity</th><td className="num">{f(s.survival_at_maturity, 10)}</td></tr>
                  <tr><th scope="row">default_probability_to_maturity</th><td className="num">{f(1 - s.survival_at_maturity, 10)}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="note">CDS2015 Schedule（{s.schedule.length} 日付）：{s.schedule.join("、")}。最初の日付は取引日より前の IMM 日（3・6・9・12月の20日）です。</p>
          </>
        );
      }}
    </Need>
  );
}

/** II-5.6.1–5.6.3: the ISDA value, its decomposition, fair spread and fair upfront. */
export function IsdaValuePanel() {
  return (
    <Need>
      {(d) => {
        const v = d.isda.isda;
        const sum = v.coupon_leg_npv + v.default_leg_npv + v.accrual_rebate_npv;
        return (
          <>
            <ValueTiles v={v} testid="isda" rebate />
            <div className="table-wrap">
              <table className="data">
                <caption>ISDA CDS NPV decomposition と Fair Upfront（契約 Coupon {bp(d.isda.coupon, 1)}、市場 Spread {bp(d.isda.spread, 3)}）　<Tag d={d} /></caption>
                <tbody>
                  <tr><th scope="row">coupon_leg_npv</th><td className="num">{yen(v.coupon_leg_npv)}</td></tr>
                  <tr><th scope="row">default_leg_npv</th><td className="num">{yen(v.default_leg_npv)}</td></tr>
                  <tr><th scope="row">accrual_rebate_npv</th><td className="num">{yen(v.accrual_rebate_npv)}</td></tr>
                  <tr><th scope="row">three_component_sum</th><td className="num">{yen(sum)}</td></tr>
                  <tr><th scope="row">reported_npv</th><td className="num">{yen(v.npv)}</td></tr>
                  <tr><th scope="row">difference</th><td className="num">{(v.npv - sum).toExponential(3)}</td></tr>
                  <tr><th scope="row">fair_spread</th><td className="num">{bp(v.fair_spread)}</td></tr>
                  <tr><th scope="row">fair_upfront / fair_upfront_amount</th><td className="num" data-testid="isda-upfront">{pct(v.fair_upfront)} / {yen(d.isda.fair_upfront_amount)}</td></tr>
                </tbody>
              </table>
            </div>
          </>
        );
      }}
    </Need>
  );
}

/** II-5.6.6: MidPoint and ISDA engines on the same curves. */
export function EngineComparisonTable() {
  return (
    <Need>
      {(d) => {
        const m = d.isda.midpoint, i = d.isda.isda;
        const rows: [string, number, number, (x: number) => string][] = [
          ["npv", m.npv, i.npv, yen], ["coupon_leg_npv", m.coupon_leg_npv, i.coupon_leg_npv, yen], ["default_leg_npv", m.default_leg_npv, i.default_leg_npv, yen],
          ["accrual_rebate_npv", m.accrual_rebate_npv, i.accrual_rebate_npv, yen], ["fair_spread", m.fair_spread, i.fair_spread, (x) => bp(x)],
          ["fair_upfront", m.fair_upfront, i.fair_upfront, (x) => pct(x, 6)],
        ];
        return (
          <div className="table-wrap">
            <table className="data">
              <caption>MidPoint and ISDA CDS engine comparison（同じ Hazard {pct(d.isda.hazard, 6)}、割引率、Recovery、標準 Coupon）　<Tag d={d} /></caption>
              <thead><tr><th scope="col">metric</th><th scope="col" className="num">MidPoint</th><th scope="col" className="num">ISDA</th><th scope="col" className="num">ISDA − MidPoint</th></tr></thead>
              <tbody>{rows.map(([k, a, b, fmt]) => (
                <tr key={k}><th scope="row">{k}</th><td className="num">{fmt(a)}</td><td className="num">{fmt(b)}</td>
                  <td className="num" data-testid={k === "npv" ? "engine-diff-npv" : undefined}>{k === "fair_spread" ? bp(b - a) : k === "fair_upfront" ? pct(b - a, 6) : yen(b - a)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        );
      }}
    </Need>
  );
}

/** The fair upfront of the standard swap as the market spread moves (an addition of this page). */
export function UpfrontChart() {
  return (
    <Need>
      {(d) => {
        const pts = d.upfront_by_spread.map((r) => ({ x: r.spread_bp, y: r.fair_upfront * 100, date: `市場 Spread ${r.spread_bp} bp` }));
        const now = { x: d.isda.spread * 1e4, y: d.isda.isda.fair_upfront * 100, date: `いまの市場 Spread ${f(d.isda.spread * 1e4, 3)} bp` };
        return (
          <LineChart title={`標準5年物の Fair Upfront と市場 Spread（契約 Coupon ${f(d.isda.coupon * 1e4, 0)} bp、Recovery ${f(d.isda.recovery * 100, 0)}%、割引率 ${f(d.isda.rate * 100, 2)}%）`}
            origin={d.isda.trade_date} xMin={0} xMax={300} xLabel="市場 Spread（bp）" yLabel="Fair Upfront（Notional 比、%）"
            xTicks={[0, 50, 100, 150, 200, 250, 300].map((x) => ({ x, label: String(x) }))}
            series={[
              { key: "u", label: "Fair Upfront（ISDA）", color: "var(--series-1)", points: pts },
              { key: "now", label: "いまの前提", color: "var(--series-2)", points: [now], dots: [now] },
            ]}
            markers={d.isda.coupon * 1e4 <= 300 ? [{ x: d.isda.coupon * 1e4, label: "Spread = 契約 Coupon" }] : []} zeroLine
            formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => `${y.toFixed(1)}%`} footer={<Tag d={d} />} />
        );
      }}
    </Need>
  );
}
