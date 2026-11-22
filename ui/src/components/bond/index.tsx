import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchBond, type BondInputs, type BondResponse, type ShapeInputs } from "../../api/bond";
import { LineChart } from "../LineChart";
import { FlowChart } from "../FlowChart";

// Components of the deterministic cash-flow chapter (Coral-Book II-1). The reader moves the shapes of the
// schematic curves and the bond's simple yield, coupon and zero spread; each change asks the R API (rmql).

type Req = { shapes: ShapeInputs; bond: BondInputs };
type Section = keyof Req;
const DEFAULT: Req = {
  shapes: { normalLevelPct: 1, normalSlopePct: 0.2, invertedLevelPct: 3.5, invertedSlopePct: -0.15 },
  bond: { simpleYieldPct: 6.515, couponPct: 7.5, zSpreadBp: 50, tradeDate: "2022-03-30", issueDate: "2022-04-01", maturityDate: "2062-04-01" },
};

interface BState {
  data: BondResponse | null; loading: boolean; error: string | null; req: Req;
  set: <S extends Section>(s: S, p: Partial<Req[S]>) => void; reset: (s: Section) => void;
}
const Ctx = createContext<BState | null>(null);

export function BondProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState(DEFAULT);
  const [data, setData] = useState<BondResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchBond(req, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 300);
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
  if (!s) throw new Error("useB must be used inside BondProvider");
  return s;
}
function Need({ children }: { children: (d: BondResponse) => ReactNode }) {
  const { data, error } = useB();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（R APIの応答がないため表示できません）</p>;
  return <p className="muted">計算中…</p>;
}
const Tag = ({ d }: { d: BondResponse }) => <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>;
const f = (x: number, n: number) => x.toFixed(n);
const t3 = (x: number) => (Math.trunc(x * 1000) / 1000).toFixed(3);
const pct = (x: number, n = 4) => `${f(x * 100, n)}%`;
const sci = (x: number) => (x === 0 ? "0" : x.toExponential(2));
const yearsFrom = (origin: string, date: string) => (Date.parse(date) - Date.parse(origin)) / 86_400_000 / 365;

export function BondStatus() {
  const { error, loading, data } = useB();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "R APIで計算中…" : data ? `計算エンジン：${data.conventions.engine}（R、HTTP API）` : ""}</p>;
}

type Field = { key: string; label: string; step: number; min: number; max: number };
const FIELDS: Record<Section, Field[]> = {
  shapes: [
    { key: "normalLevelPct", label: "順イールドの水準（%）", step: 0.1, min: -2, max: 15 },
    { key: "normalSlopePct", label: "順イールドの傾き（%/年）", step: 0.05, min: -1, max: 1 },
    { key: "invertedLevelPct", label: "逆イールドの水準（%）", step: 0.1, min: -2, max: 15 },
    { key: "invertedSlopePct", label: "逆イールドの傾き（%/年）", step: 0.05, min: -1, max: 1 },
  ],
  bond: [
    { key: "simpleYieldPct", label: "単利利回り（%）", step: 0.005, min: 0.1, max: 15 },
    { key: "couponPct", label: "クーポン（%）", step: 0.1, min: 0, max: 15 },
    { key: "zSpreadBp", label: "Zスプレッド（bp）", step: 5, min: -500, max: 1000 },
  ],
};
const NAMES: Record<Section, string> = { shapes: "模式図", bond: "債券" };
const DATE_FIELDS: { key: "tradeDate" | "issueDate" | "maturityDate"; label: string }[] = [
  { key: "tradeDate", label: "取引日" }, { key: "issueDate", label: "発行日" }, { key: "maturityDate", label: "償還日" },
];

export function BondControls({ which }: { which: Section }) {
  const { req, set, reset, loading, data } = useB();
  return (
    <div className="controls" role="group" aria-label={`${NAMES[which]}の前提`} data-section={which}>
      {FIELDS[which].map((fd) => (
        <label key={fd.key}>{fd.label}{" "}
          <input type="number" step={fd.step} min={fd.min} max={fd.max} className="rate-input" aria-label={`${NAMES[which]}：${fd.label}`}
            value={(req[which] as unknown as Record<string, number>)[fd.key]}
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set(which, { [fd.key]: v } as never); }} />
        </label>
      ))}
      {which === "bond" && DATE_FIELDS.map((fd) => (
        <label key={fd.key}>{fd.label}{" "}
          <input type="date" className="rate-input date-input" aria-label={`${NAMES[which]}：${fd.label}`} value={req.bond[fd.key]} data-testid={`bond-${fd.key}`}
            onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) set("bond", { [fd.key]: e.target.value }); }} />
        </label>
      ))}
      <button type="button" onClick={() => reset(which)}>初期値に戻す</button>
      <span className="controls-state">{loading ? "R APIで再計算中…" : data ? <Tag d={data} /> : null}</span>
    </div>
  );
}

const CURVE_COLORS = { par: "var(--series-1)", spot: "var(--series-2)", fwd: "var(--series-3)" };

/** Par, spot and forward rates of the TONAR curve at the pillars. */
export function TonarCurves() {
  return (
    <Need>
      {(d) => {
        const origin = "2026-09-10";
        const pt = (k: "par_rate" | "zero_rate" | "inst_fwd_rate") => d.tonar.map((r) => ({ x: yearsFrom(origin, r.pillar_date), y: r[k] * 100, date: `${r.pillar_date}（${r.tenor}）` }));
        const s = (key: string, label: string, color: string, k: "par_rate" | "zero_rate" | "inst_fwd_rate", dashed = false) => ({ key, label, color, dashed, points: pt(k), dots: pt(k) });
        return (
          <div className="two-col">
            <LineChart title="TONARイールドカーブ：パーレート・スポットレート・フォワードレートの比較" origin={origin} xMax={30.1} height={290} yLabel="金利（%）"
              series={[s("par", "パーレート", CURVE_COLORS.par, "par_rate"), s("spot", "スポットレート", CURVE_COLORS.spot, "zero_rate", true), s("fwd", "フォワードレート", CURVE_COLORS.fwd, "inst_fwd_rate")]}
              formatY={(y) => `${y.toFixed(4)}%`} formatTick={(y) => `${y.toFixed(1)}%`} footer={<Tag d={d} />} />
            <div className="table-wrap">
              <table className="data">
                <caption>TONAR の各ピラー（{origin} 時点）　<Tag d={d} /></caption>
                <thead><tr><th scope="col">年限</th><th scope="col">ピラー日</th><th scope="col" className="num">パーレート</th><th scope="col" className="num">割引係数</th>
                  <th scope="col" className="num">スポット（連続複利）</th><th scope="col" className="num">瞬間フォワード</th><th scope="col" className="num">気配の再現誤差</th></tr></thead>
                <tbody>{d.tonar.map((r) => (
                  <tr key={r.quote_id}><th scope="row">{r.tenor}</th><td>{r.pillar_date}</td><td className="num">{pct(r.par_rate, 3)}</td><td className="num">{f(r.discount_factor, 10)}</td>
                    <td className="num">{pct(r.zero_rate, 6)}</td><td className="num">{pct(r.inst_fwd_rate, 6)}</td><td className="num">{sci(r.repricing_error)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        );
      }}
    </Need>
  );
}

/** II-1.2.5: the schematic normal and inverted curves (the manuscript's facets, as two charts). */
export function ShapeCharts() {
  return (
    <Need>
      {(d) => (
        <div className="chart-pair">
          {["順イールド", "逆イールド"].map((shape) => {
            const rows = d.shapes.filter((r) => r.curve_shape === shape);
            const pt = (k: "par_rate" | "spot_rate" | "forward_rate") => rows.map((r) => ({ x: r.maturity, y: r[k] * 100, date: `${r.maturity}年` }));
            return (
              <LineChart key={shape} title={`${shape}：三つの金利`} origin="2026-01-01" xMin={1} xMax={10} xLabel="満期（年）" yLabel="金利（%）" height={250}
                xTicks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({ x, label: String(x) }))}
                series={[
                  { key: "par", label: "パーレート", color: CURVE_COLORS.par, points: pt("par_rate") },
                  { key: "spot", label: "スポットレート", color: CURVE_COLORS.spot, dashed: true, points: pt("spot_rate") },
                  { key: "fwd", label: "フォワードレート", color: CURVE_COLORS.fwd, points: pt("forward_rate") },
                ]}
                formatY={(y) => `${y.toFixed(3)}%`} formatTick={(y) => `${y.toFixed(1)}%`} footer={<Tag d={d} />} />
            );
          })}
        </div>
      )}
    </Need>
  );
}

function KeyValue({ caption, rows, d }: { caption: string; rows: [string, string, string?][]; d: BondResponse }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <caption>{caption}　<Tag d={d} /></caption>
        <tbody>{rows.map(([k, v, id]) => <tr key={k}><th scope="row">{k}</th><td className="num" data-testid={id}>{v}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** II-1.3: the bond, its settlement date and its 81 cash flows. */
export function BondCashflows() {
  return (
    <Need>
      {(d) => {
        const b = d.bond;
        return (
          <>
            <KeyValue d={d} caption="固定利付債の計算条件" rows={[
              ["trade_date", b.trade_date], ["settlement_date", b.settlement_date, "settlement"], ["issue_date", b.issue_date], ["maturity_date", b.maturity_date],
              ["face_amount", "100"], ["coupon_rate_pct", f(b.coupon_pct, 4)], ["frequency", "Semiannual（30/360 Bond Basis）"],
            ]} />
            <FlowChart title={`債券キャッシュフロー（${b.cashflows.length} 件、額面100あたり）`} origin={b.settlement_date} xMax={40.2} yLabel="金額" legend
              series={[{ key: "coupon", label: "クーポン", color: "var(--series-1)" }, { key: "redemption", label: "償還", color: "var(--series-2)" }]}
              bars={b.cashflows.map((c) => ({ date: c.payment_date, x: yearsFrom(b.settlement_date, c.payment_date), value: c.amount, series: c.kind, label: c.kind === "coupon" ? "クーポン" : "償還" }))}
              formatY={(y) => y.toFixed(2)} footer={<Tag d={d} />} />
            <details>
              <summary>キャッシュフロー表（{b.cashflows.length} 件）を開く</summary>
              <div className="table-wrap">
                <table className="data">
                  <caption>債券キャッシュフロー　<Tag d={d} /></caption>
                  <thead><tr><th scope="col" className="num">#</th><th scope="col">支払日</th><th scope="col">種類</th><th scope="col">計算期間</th><th scope="col" className="num">金額</th></tr></thead>
                  <tbody>{b.cashflows.map((c, i) => (
                    <tr key={`${c.payment_date}-${c.kind}`}><th scope="row" className="num">{i + 1}</th><td>{c.payment_date}</td><td>{c.kind === "coupon" ? "クーポン" : "償還"}</td>
                      <td>{c.accrual_start ? `${c.accrual_start} 〜 ${c.accrual_end}` : "—"}</td><td className="num">{f(c.amount, 6)}</td></tr>
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

/** II-1.4–1.5: simple yield -> price -> compound yield, flat yield and continuous compounding. */
export function YieldChain() {
  return (
    <Need>
      {(d) => {
        const b = d.bond;
        return (
          <>
            <div className="tiles">
              <div className="tile emphasis"><div className="tile-label">単価（単利 {f(b.simple_yield_pct, 3)}% から）</div><div className="tile-value" data-testid="clean-price">{f(b.clean_price, 3)}</div>
                <div className="tile-note">残存 {f(b.remaining_years, 7)} 年、小数3桁で切り捨て</div></div>
              <div className="tile"><div className="tile-label">複利利回り（半年複利）</div><div className="tile-value" data-testid="compound-yield">{t3(b.compound_yield_pct)}%</div>
                <div className="tile-note">単価から逆算、小数3桁（4桁目切り捨て）</div></div>
              <div className="tile"><div className="tile-label">連続複利に換算</div><div className="tile-value">{t3(b.continuous_yield * 100)}%</div>
                <div className="tile-note">r = 2 log(1 + y/2)（小数3桁、4桁目切り捨て）</div></div>
            </div>
            <KeyValue d={d} caption="単利利回り → クリーンプライス → 複利利回り → フラットイールド" rows={[
              ["remaining_years", f(b.remaining_years, 7)], ["simple_rate_pct（入力）", f(b.simple_yield_pct, 6)], ["clean_price_from_simple_rate", f(b.clean_price, 6)],
              ["simple_rate_from_price_pct", f(b.simple_from_price, 7)], ["compound_yield_pct", t3(b.compound_yield_pct)], ["price_from_compound_yield", f(b.compound_price, 6)],
              ["accrued_interest（受渡日は利払日）", f(b.accrued, 6)], ["flat_yield_pct", t3(b.compound_yield_pct)],
              ["dirty_price（フラットイールドのカーブで評価）", f(b.flat_dirty_price, 10), "flat-dirty"], ["continuous_yield_pct", t3(b.continuous_yield * 100)],
            ]} />
          </>
        );
      }}
    </Need>
  );
}

/** II-1.6.2: the zero spread on the flat curve, and back. */
export function ZSpreadTable() {
  return (
    <Need>
      {(d) => (
        <KeyValue d={d} caption="Zスプレッド：フラットイールドのカーブに一律に加えて評価（半年複利）" rows={[
          ["z_spread_bp（入力）", f(d.bond.z_spread_bp, 4)], ["npv_with_zspread", f(d.bond.z_spread_npv, 8), "z-npv"],
          ["スプレッドなしの価格との差", f(d.bond.z_spread_npv - d.bond.flat_dirty_price, 8)], ["NPV から逆算した Zスプレッド（bp）", f(d.bond.z_spread_back_bp, 6)],
        ]} />
      )}
    </Need>
  );
}

/** II-1.7: duration, convexity and BPV by the manuscript's formulas and by rmql. */
export function RiskTable() {
  return (
    <Need>
      {(d) => {
        const r = d.bond.risk, fm = d.bond.formula, z = d.bond.zero_yield;
        const rows: [string, number, number, number][] = [
          ["price", fm.price, r.price, 8], ["dP/dY（円／1%）", fm.dp_dy_pct, r.dp_dy_pct, 8], ["d²P/dY²（円／1%²）", fm.d2p_dy2_pct, r.d2p_dy2_pct, 8],
          ["BPV（銭／bp）", fm.bpv_sen, r.bpv_sen, 6], ["BPV（円／bp）", fm.bpv_yen, r.bpv_yen, 8],
          ["modified_duration", fm.modified_duration, r.modified_duration, 3], ["convexity", fm.convexity, r.convexity, 3],
        ];
        return (
          <>
            <div className="tiles">
              <div className="tile emphasis"><div className="tile-label">BPV</div><div className="tile-value" data-testid="bpv-sen">{f(r.bpv_sen, 4)} 銭／bp</div><div className="tile-note">= {f(r.bpv_yen, 6)} 円／bp（額面100）</div></div>
              <div className="tile"><div className="tile-label">修正デュレーション</div><div className="tile-value" data-testid="mod-duration">{t3(r.modified_duration)}</div><div className="tile-note">−100/P · dP/dY（小数3桁、4桁目切り捨て）</div></div>
              <div className="tile"><div className="tile-label">コンベクシティ</div><div className="tile-value" data-testid="convexity">{t3(r.convexity)}</div><div className="tile-note">10000/P · d²P/dY²（小数3桁、4桁目切り捨て）</div></div>
            </div>
            <div className="table-wrap">
              <table className="data">
                <caption>債券価格と金利リスク指標（解析式と計算エンジン、Y = {t3(d.bond.compound_yield_pct)}%）　<Tag d={d} /></caption>
                <thead><tr><th scope="col">指標</th><th scope="col" className="num">解析式</th><th scope="col" className="num">計算エンジン</th><th scope="col" className="num">差</th></tr></thead>
                <tbody>{rows.map(([k, a, b, n]) => <tr key={k}><th scope="row">{k}</th><td className="num">{n === 3 ? t3(a) : f(a, n)}</td><td className="num">{n === 3 ? t3(b) : f(b, n)}</td><td className="num">{sci(a - b)}</td></tr>)}</tbody>
              </table>
            </div>
            <KeyValue d={d} caption="Y = 0 の場合（別の式で扱う）" rows={[
              ["price = 100 + CT", f(z.price, 6)], ["dP/dY = −{CT(2T+1)/400 + T}", f(z.dp_dy_pct, 6)], ["BPV（銭／bp）", f(-z.dp_dy_pct, 6)],
              ["d²P/dY²", f(z.d2p_dy2_pct, 8)], ["modified_duration", t3(z.modified_duration)], ["convexity", t3(z.convexity)],
            ]} />
          </>
        );
      }}
    </Need>
  );
}

/** The price-yield curve with the first- and second-order approximations (an addition of this page). */
export function PriceYieldChart() {
  return (
    <Need>
      {(d) => {
        const rows = d.bond.price_yield;
        const pt = (k: "price" | "duration_approx" | "convexity_approx") => rows.map((r) => ({ x: r.yield_pct, y: r[k], date: `複利利回り ${f(r.yield_pct, 2)}%` }));
        const now = { x: d.bond.compound_yield_pct, y: d.bond.formula.price, date: `いまの利回り ${t3(d.bond.compound_yield_pct)}%` };
        return (
          <LineChart title={`価格と複利利回り：デュレーション（一次）とコンベクシティ（二次）の近似（${f(d.bond.coupon_pct, 2)}%・40年債）`} origin="2022-04-01"
            xMin={0} xMax={15} xLabel="複利利回り（%）" yLabel="単価" xTicks={[0, 3, 6, 9, 12, 15].map((x) => ({ x, label: `${x}%` }))}
            series={[
              { key: "p", label: "価格（解析式）", color: "var(--series-1)", points: pt("price") },
              { key: "d", label: "一次近似 P + dP/dY·ΔY", color: "var(--series-2)", dashed: true, points: pt("duration_approx") },
              { key: "c", label: "二次近似（＋コンベクシティ）", color: "var(--series-3)", dashed: true, points: pt("convexity_approx") },
              { key: "now", label: "いまの利回り", color: "var(--text-muted)", points: [now], dots: [now] },
            ]}
            formatY={(y) => y.toFixed(3)} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
        );
      }}
    </Need>
  );
}

/** II-1.8: the root finders, their steps and their speed. */
export function SolverPanel() {
  return (
    <Need>
      {(d) => {
        const b = d.bond;
        return (
          <>
            <div className="table-wrap">
              <table className="data">
                <caption>40年債：同一複利利回りを求める数値解法の比較（単価 {f(b.clean_price, 3)}、80次の多項式。計算時間はこのサーバーの R での実測）　<Tag d={d} /></caption>
                <thead><tr><th scope="col">method</th><th scope="col" className="num">compound_yield_pct</th><th scope="col" className="num">反復回数</th>
                  <th scope="col" className="num">P(Y) − P_market</th><th scope="col" className="num">1回の計算時間（μs）</th></tr></thead>
                <tbody>{b.solvers.map((s, i) => (
                  <tr key={s.method}><th scope="row">{s.method}</th><td className="num" data-testid={`solver-${i}`}>{i === 4 ? t3(s.yield_pct) : f(s.yield_pct, 10)}</td><td className="num">{s.iterations ?? "—"}</td>
                    <td className="num">{sci(s.price_error)}</td><td className="num">{f(s.average_us, 1)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p className="note">
              日本の国債実務の規則どおり小数3桁（4桁目切り捨て）にする場合と、高精度求根アルゴリズムによる違いを確認できます。
              多項式 {b.polyroot.degree} 次の根 {b.polyroot.roots} 個のうち、正の実根は {b.polyroot.real_positive} 個でした。
            </p>
            <div className="two-col">
              <div className="table-wrap">
                <table className="data">
                  <caption>ニュートン・ラフソン法の反復（初期値は単利利回り {f(b.simple_yield_pct, 3)}%、解析微分 dP/dY を傾きに使う）</caption>
                  <thead><tr><th scope="col" className="num">k</th><th scope="col" className="num">Y_k（%）</th><th scope="col" className="num">f(Y_k) = P − P_market</th><th scope="col" className="num">dP/dY</th></tr></thead>
                  <tbody>{b.newton_steps.map((s) => (
                    <tr key={s.iteration}><th scope="row" className="num">{s.iteration}</th><td className="num">{f(s.yield_pct, 12)}</td><td className="num">{sci(s.objective)}</td><td className="num">{f(s.derivative, 8)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <LineChart title={`二分法の区間の縮み方（${b.bisection_iterations} 回で |区間| < 1e-12。縦軸は区間の幅、対数）`} origin="2022-04-01"
                xMin={1} xMax={Math.max(2, b.bisection_steps.length)} xLabel="反復" yLabel="log₁₀ 区間の幅"
                xTicks={[1, 10, 20, 30, 40, 50].filter((x) => x <= b.bisection_steps.length).map((x) => ({ x, label: String(x) }))}
                series={[{ key: "w", label: "区間の幅", color: "var(--series-1)", points: b.bisection_steps.map((s) => ({ x: s.iteration, y: Math.log10(s.upper - s.lower), date: `${s.iteration} 回目：[${f(s.lower, 6)}, ${f(s.upper, 6)}]` })) }]}
                formatY={(y) => `10^${y.toFixed(2)}`} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
            </div>
          </>
        );
      }}
    </Need>
  );
}
