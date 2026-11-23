import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchFutures, type FuturesResponse } from "../../api/futures";
import { LineChart } from "../LineChart";

// Components of the JGB futures chapter (Coral-Book II-2.6–2.7). The reader switches between the current
// market (fictitious prices) and a flat yield level for every deliverable bond, and sets the funding rate; each
// change asks the R API (rmql).

type Req = { mode: "current" | "flat"; yieldPct: number; fundingPct: number };
const DEFAULT: Req = { mode: "current", yieldPct: 8, fundingPct: 1.23 };

interface FState { data: FuturesResponse | null; loading: boolean; error: string | null; req: Req; set: (r: Partial<Req>) => void }
const Ctx = createContext<FState | null>(null);

export function FuturesProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<Req>(DEFAULT);
  const [data, setData] = useState<FuturesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchFutures(req.mode === "current" ? { mode: "current", fundingPct: req.fundingPct } : req, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 250);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [req]);
  return <Ctx.Provider value={{ data, loading, error, req, set: (r) => setReq((x) => ({ ...x, ...r })) }}>{children}</Ctx.Provider>;
}
function useF(): FState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useF must be used inside FuturesProvider");
  return s;
}
function Need({ children }: { children: (d: FuturesResponse) => ReactNode }) {
  const { data, error } = useF();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（R APIの応答がないため表示できません）</p>;
  return <p className="muted">計算中…</p>;
}
const Tag = ({ d }: { d: FuturesResponse }) => <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>;
const f = (x: number, n: number) => x.toFixed(n);
const t3 = (x: number) => (Math.trunc(x * 1000) / 1000).toFixed(3);

export function FuturesStatus() {
  const { error, loading } = useF();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "計算中…" : ""}</p>;
}

export function FuturesControls() {
  const { req, set, loading, data } = useF();
  return (
    <div className="controls" role="group" aria-label="市場の前提">
      <label><input type="radio" name="fmode" checked={req.mode === "current"} onChange={() => set({ mode: "current", fundingPct: 1.23 })} /> 現在の市場（架空の価格）</label>
      <label><input type="radio" name="fmode" checked={req.mode === "flat"} onChange={() => set({ mode: "flat", yieldPct: 8, fundingPct: 9 })} /> 全銘柄を同じ複利利回りで評価</label>
      {req.mode === "flat" && (
        <label>複利利回り（%）{" "}
          <input type="number" step="0.25" min="0.25" max="15" value={req.yieldPct} className="rate-input" aria-label="複利利回り（%）"
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set({ yieldPct: v }); }} />
        </label>
      )}
      <label>Funding Rate（%）{" "}
        <input type="number" step="0.01" value={req.fundingPct} className="rate-input" aria-label="Funding Rate（%）"
          onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) set({ fundingPct: v }); }} />
      </label>
      {req.mode === "flat" && <button type="button" onClick={() => set({ yieldPct: 8, fundingPct: 9 })}>ストレスシナリオ（8%・9%）</button>}
      <span className="controls-state">{loading ? "再計算中…" : data ? <>CTD：<strong data-testid="ctd-issue">{data.ctd_issue}回債</strong>　<Tag d={data} /></> : null}</span>
    </div>
  );
}

/** II-2.6.1–2.6.3: the basket with yield, duration, basis, implied repo and the CTD. */
export function BasketTable() {
  return (
    <Need>
      {(d) => (
        <div className="table-wrap">
          <table className="data">
            <caption>
              {d.mode === "current" ? "JGB basis, implied repo and CTD（現在の市場、架空の価格）" : `JGB stress scenario：全銘柄 ${f(d.flat_yield! * 100, 2)}% 複利、Funding ${f(d.funding_rate * 100, 2)}%`}
              。先物価格 {f(d.futures_price, d.mode === "current" ? 2 : 6)}、評価日 {d.valuation_date}、受渡日 {d.delivery_date}　<Tag d={d} />
            </caption>
            <thead><tr><th scope="col">回号</th><th scope="col" className="num">クーポン（%）</th><th scope="col">償還日</th><th scope="col" className="num">価格</th>
              <th scope="col" className="num">複利利回り（%）</th><th scope="col" className="num">修正デュレーション</th><th scope="col" className="num">CF</th>
              <th scope="col" className="num">Gross Basis</th><th scope="col" className="num">Net Basis</th><th scope="col" className="num">Implied Repo（%）</th><th scope="col">CTD</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.issue} className={r.ctd ? "changed" : undefined}>
                <th scope="row">{r.issue}</th><td className="num">{f(r.coupon_pct, 1)}</td><td>{r.maturity_date}</td><td className="num">{f(r.price, 3)}</td>
                <td className="num">{t3(r.yield * 100)}</td><td className="num">{t3(r.duration)}</td><td className="num">{f(r.conversion_factor, 6)}</td>
                <td className="num">{f(r.gross_basis, 4)}</td><td className="num" data-testid={`net-basis-${r.issue}`}>{f(r.net_basis, 4)}</td><td className="num">{f(r.implied_repo * 100, 4)}</td>
                <td>{r.ctd ? "◀ CTD" : ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Need>
  );
}

export function CarryTable() {
  return (
    <Need>
      {(d) => (
        <div className="table-wrap">
          <table className="data">
            <caption>Carry の内訳（額面100あたり。保有日数 {Math.round((Date.parse(d.delivery_date) - Date.parse(d.valuation_date)) / 86_400_000)} 日、Funding {f(d.funding_rate * 100, 2)}%）</caption>
            <thead><tr><th scope="col">回号</th><th scope="col" className="num">経過利子（評価日）</th><th scope="col" className="num">経過利子（受渡日）</th><th scope="col" className="num">保有期間のクーポン</th>
              <th scope="col" className="num">Funding Cost</th><th scope="col" className="num">Carry</th><th scope="col" className="num">受渡価格 F×CF</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.issue} className={r.ctd ? "changed" : undefined}><th scope="row">{r.issue}</th><td className="num">{f(r.accrued_start, 6)}</td><td className="num">{f(r.accrued_end, 6)}</td>
                <td className="num">{f(r.coupon_income, 4)}</td><td className="num">{f(r.funding_cost, 6)}</td><td className="num">{f(r.carry, 6)}</td><td className="num">{f(r.futures_invoice, 4)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Need>
  );
}

/** Futures BPV from the CTD (GaussQuant futures_bpv_GQL). */
export function FuturesBpvPanel() {
  return (
    <Need>
      {(d) => {
        const ctd = d.rows.find((r) => r.issue === d.ctd_issue)!;
        return (
          <>
            <div className="tiles">
              <div className="tile emphasis"><div className="tile-label">先物BPV（額面100あたり）</div><div className="tile-value" data-testid="futures-bpv">{f(d.futures_bpv, 6)}</div>
                <div className="tile-note">= CTD の DV01 {f(d.ctd_dv01, 6)} ÷ CF {f(d.ctd_conversion_factor, 6)}</div></div>
              <div className="tile"><div className="tile-label">先物1枚（額面1億円）の BPV</div><div className="tile-value">{Math.round(d.futures_bpv * 1e6).toLocaleString("ja-JP")} 円</div>
                <div className="tile-note">先物BPV × 1億円 / 100</div></div>
              <div className="tile"><div className="tile-label">CTD（{d.ctd_issue}回債）</div><div className="tile-value tile-small">修正デュレーション {t3(ctd.duration)}</div>
                <div className="tile-note">参考：解析的 BPV {f(ctd.bpv_analytic, 6)}（ダーティ価格の変化、符号つき）</div></div>
            </div>
            <div className="table-wrap">
              <table className="data">
                <caption>各銘柄の DV01 と、その銘柄が CTD なら先物BPV になる値　<Tag d={d} /></caption>
                <thead><tr><th scope="col">回号</th><th scope="col" className="num">DV01（±1bp）</th><th scope="col" className="num">CF</th><th scope="col" className="num">DV01 ÷ CF</th><th scope="col" className="num">解析的 BPV</th></tr></thead>
                <tbody>{d.rows.map((r) => (
                  <tr key={r.issue} className={r.ctd ? "changed" : undefined}><th scope="row">{r.issue}</th><td className="num">{f(r.dv01, 6)}</td><td className="num">{f(r.conversion_factor, 6)}</td>
                    <td className="num">{f(r.dv01 / r.conversion_factor, 6)}</td><td className="num">{f(r.bpv_analytic, 6)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        );
      }}
    </Need>
  );
}

const pctTicks = (lo: number, hi: number, step: number) => { const t = []; for (let v = lo; v <= hi + 1e-9; v += step) t.push({ x: v, label: `${v}%` }); return t; };

/** II-2.7.2: the two yield-curve regimes. */
export function RegimeChart() {
  return (
    <Need>
      {(d) => (
        <LineChart title="Yield-curve regime change and CTD switching（点線の目盛り 6% が標準物のクーポン）" origin={d.valuation_date} xMax={10} yLabel="Yield (%)" xLabel="Maturity (years)"
          xTicks={[0, 2, 4, 6, 8, 10].map((x) => ({ x, label: String(x) }))}
          series={[
            { key: "c", label: "Current market（基準例）", color: "var(--series-1)", points: d.current_curve.map((p) => ({ x: p.tenor_years, y: p.yield_pct, date: `${p.tenor_years}年` })), dots: d.current_curve.map((p) => ({ x: p.tenor_years, y: p.yield_pct, date: `${p.tenor_years}年` })) },
            { key: "s", label: "Stress: inverted", color: "var(--series-2)", dashed: true, points: d.stress_curve.map((p) => ({ x: p.tenor_years, y: p.yield_pct, date: `${p.tenor_years}年` })), dots: d.stress_curve.map((p) => ({ x: p.tenor_years, y: p.yield_pct, date: `${p.tenor_years}年` })) },
            { key: "std", label: "Standard bond coupon = 6%", color: "var(--text-muted)", dashed: true, points: [{ x: 0, y: 6, date: "6%" }, { x: 10, y: 6, date: "6%" }] },
          ]}
          formatY={(y) => `${y.toFixed(2)}%`} formatTick={(y) => y.toFixed(0)} />
      )}
    </Need>
  );
}

/** CTD by yield level at the chosen funding rate: where the CTD switches. */
export function CtdSwitchChart() {
  return (
    <Need>
      {(d) => {
        const pts = d.ctd_by_level.map((r) => ({ x: r.yield_pct, y: r.ctd_duration, date: `${r.yield_pct}%：CTD ${r.ctd_issue}回債` }));
        const switches = d.ctd_by_level.filter((r, i) => i > 0 && r.ctd_issue !== d.ctd_by_level[i - 1].ctd_issue);
        return (
          <>
            <LineChart title={`CTD の修正デュレーション（全銘柄を同じ利回りで評価、Funding ${f(d.funding_rate * 100, 2)}%）`} origin={d.valuation_date} xMin={1} xMax={10}
              yLabel="CTD の修正デュレーション" xLabel="複利利回り（%）" xTicks={pctTicks(1, 10, 1)}
              series={[{ key: "ctd", label: "CTD", color: "var(--series-1)", points: pts, dots: pts }]}
              markers={[{ x: 6, label: "標準物 6%" }, ...switches.map((s) => ({ x: s.yield_pct, label: `→${s.ctd_issue}回債` }))]}
              formatY={(y) => t3(y)} formatTick={(y) => y.toFixed(1)} footer={<Tag d={d} />} />
            <p className="note">
              {switches.length ? <>利回り {switches.map((s) => `${s.yield_pct}%`).join("・")} で CTD が入れ替わる（0.25% 刻み）。</> : "この Funding Rate では、1〜10% の範囲で CTD は入れ替わらない。"}
              Funding Rate を変えると、入れ替わる水準も動く。
            </p>
          </>
        );
      }}
    </Need>
  );
}
