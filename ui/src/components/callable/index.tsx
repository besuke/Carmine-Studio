import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchCallable, type BondInputs, type CallableResponse, type MbsInputs } from "../../api/callable";
import { LineChart } from "../LineChart";

// Components of the early redemption chapter (Coral-Book II-8): the callable bond under Hull-White, and the
// prepayment of a mortgage pool. Each change of the inputs asks the R API.

type Req = { bond: BondInputs; mbs: MbsInputs };
type Section = keyof Req;
const DEFAULT: Req = {
  bond: { ratePct: 2, aPct: 15, sigmaPct: 1.2, couponPct: 3, firstCallYear: 1, callPrice: 100 },
  mbs: { psaPct: 100, incentive: 20, refiCostPct: 0.5 },
};

interface CState {
  data: CallableResponse | null; loading: boolean; error: string | null; req: Req;
  set: <S extends Section>(s: S, p: Partial<Req[S]>) => void; reset: (s: Section) => void;
}
const Ctx = createContext<CState | null>(null);

export function CallableProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState(DEFAULT);
  const [data, setData] = useState<CallableResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchCallable(req, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 300);
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
  if (!s) throw new Error("useC must be used inside CallableProvider");
  return s;
}
function Need({ children }: { children: (d: CallableResponse) => ReactNode }) {
  const { data, error } = useC();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（直前の入力では計算できません。値を戻してください）</p>;
  return <p className="muted">計算中…</p>;
}
const Tag = ({ d }: { d: CallableResponse }) => <span className="response-tag" data-request-id={d.response.request_id}>API応答 <code>{d.response.request_id}</code></span>;
const f = (x: number, n: number) => x.toFixed(n);
const pct = (x: number, n = 2) => `${f(x * 100, n)}%`;

export function CallableStatus() {
  const { error, loading } = useC();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "計算中…" : ""}</p>;
}

type Field = { key: string; label: string; step: number; min: number; max: number };
const FIELDS: Record<Section, Field[]> = {
  bond: [
    { key: "ratePct", label: "初期曲線の金利（%）", step: 0.25, min: -2, max: 10 },
    { key: "aPct", label: "平均回帰 a（%）", step: 1, min: 1, max: 100 },
    { key: "sigmaPct", label: "σ（%）", step: 0.1, min: 0, max: 3 },
    { key: "couponPct", label: "クーポン（%）", step: 0.25, min: 0, max: 10 },
    { key: "firstCallYear", label: "最初のコール日（年）", step: 0.5, min: 0.5, max: 4.5 },
    { key: "callPrice", label: "コール価格", step: 0.5, min: 90, max: 120 },
  ],
  mbs: [
    { key: "psaPct", label: "PSA（%）", step: 25, min: 0, max: 500 },
    { key: "incentive", label: "借換えの感応度 β", step: 5, min: 0, max: 50 },
    { key: "refiCostPct", label: "借換えコスト k（%）", step: 0.25, min: 0, max: 3 },
  ],
};
const NAMES: Record<Section, string> = { bond: "コール債", mbs: "MBS" };

export function CallableControls({ which }: { which: Section }) {
  const { req, set, reset, loading, data, error } = useC();
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

/** II-8.1: coupons and call dates. */
export function FlowsTable() {
  return (
    <Need>
      {(d) => (
        <div className="table-wrap">
          <table className="data">
            <caption>クーポンと発行体コール日（額面100）　<Tag d={d} /></caption>
            <thead><tr><th scope="col" className="num">支払時点（年）</th><th scope="col" className="num">クーポン</th><th scope="col" className="num">満期の元本</th><th scope="col">コール</th></tr></thead>
            <tbody>{d.bond.flows.map((r) => (
              <tr key={r.time}><th scope="row" className="num">{f(r.time, 1)}</th><td className="num">{f(r.coupon, 3)}</td><td className="num">{r.principal ? f(r.principal, 0) : "—"}</td>
                <td>{r.call_price == null ? "—" : `可（コール価格 ${f(r.call_price, 1)}）`}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Need>
  );
}

/** II-8.2 and II-8.4.2: bullet, callable and the value of the issuer's call. */
export function PricePanel() {
  return (
    <Need>
      {(d) => {
        const b = d.bond;
        return (
          <>
            <div className="tiles">
              <div className="tile"><div className="tile-label">Bullet Bond</div><div className="tile-value" data-testid="bullet">{f(b.bullet, 6)}</div>
                <div className="tile-note">初期曲線で直接割り引くと {f(b.bullet_from_curve, 6)}</div></div>
              <div className="tile emphasis"><div className="tile-label">Callable Bond</div><div className="tile-value" data-testid="callable">{f(b.callable, 6)}</div>
                <div className="tile-note">a = {pct(b.a, 1)}、σ = {pct(b.sigma, 2)}</div></div>
              <div className="tile"><div className="tile-label">発行体のコール権の価値</div><div className="tile-value" data-testid="call-value">{f(b.issuer_call_value, 6)}</div>
                <div className="tile-note">= Bullet − Callable（額面100あたり）</div></div>
            </div>
            <p className="note">格子で評価した Bullet と初期曲線から直接求めた Bullet の差は {f(b.bullet - b.bullet_from_curve, 6)} で、格子と求積の数値誤差の大きさを示します。　<Tag d={d} /></p>
          </>
        );
      }}
    </Need>
  );
}

/** The issuer's decision on year 2, and the boundary on each call date. */
export function DecisionPanel() {
  return (
    <Need>
      {(d) => {
        const rows = d.bond.decision_year2;
        const pt = (k: "continuation_ex_coupon" | "call_price") => rows.map((r) => ({ x: 100 * r.short_rate, y: r[k], date: `短期金利 ${f(100 * r.short_rate, 3)}%` }));
        const year2 = d.bond.exercise_boundary.find((r) => Math.abs(r.payment_time - 2) < 1e-9);
        return (
          <div className="two-col">
            <LineChart title="2年目のコール判断（クーポン支払後）：継続価値がコール価格を上回る金利水準でコールする" origin="2026-01-01" xMin={-2} xMax={8}
              xTicks={[-2, 0, 2, 4, 6, 8].map((x) => ({ x, label: `${x}%` }))} xLabel="その時点の短期金利" yLabel="残存元本の価格"
              series={[
                { key: "c", label: "継続価値", color: "var(--series-1)", points: pt("continuation_ex_coupon") },
                { key: "k", label: "コール価格", color: "var(--series-2)", dashed: true, points: pt("call_price") },
              ]}
              markers={year2?.call_below_short_rate != null ? [{ x: 100 * year2.call_below_short_rate, label: "コールする上限" }] : []}
              formatY={(y) => y.toFixed(4)} formatTick={(y) => y.toFixed(1)} footer={<Tag d={d} />} />
            <div className="table-wrap">
              <table className="data">
                <caption>コール日ごとの判断：この短期金利以下ならコールする</caption>
                <thead><tr><th scope="col" className="num">コール日（年）</th><th scope="col" className="num">コールする短期金利の上限</th><th scope="col" className="num">状態の格子のうちコールする割合</th></tr></thead>
                <tbody>{d.bond.exercise_boundary.map((r) => (
                  <tr key={r.payment_time}><th scope="row" className="num">{f(r.payment_time, 1)}</th>
                    <td className="num" data-testid={`boundary-${r.payment_time}`}>{r.call_below_short_rate == null ? "コールしない" : pct(r.call_below_short_rate, 3)}</td>
                    <td className="num">{pct(r.share_of_grid_called, 1)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        );
      }}
    </Need>
  );
}

/** The call value against the volatility. */
export function VolatilityPanel() {
  return (
    <Need>
      {(d) => {
        const c = d.bond.curve_by_volatility.map((r) => ({ x: 1e4 * r.volatility, y: r.issuer_call_value, date: `σ = ${f(1e4 * r.volatility, 0)} bp` }));
        const dots = d.bond.by_volatility.map((r) => ({ x: 1e4 * r.volatility, y: r.issuer_call_value, date: `σ = ${f(1e4 * r.volatility, 0)} bp` }));
        return (
          <div className="two-col">
            <LineChart title="同じ初期曲線におけるコールオプションの価値" origin="2026-01-01" xMin={0} xMax={250}
              xTicks={[0, 50, 100, 150, 200, 250].map((x) => ({ x, label: String(x) }))} xLabel="短期金利ボラティリティ（bp/√年）" yLabel="額面100あたりのコール権の価値"
              series={[{ key: "v", label: "コール権の価値", color: "var(--series-1)", points: c, dots }]}
              markers={[{ x: 1e4 * d.bond.sigma, label: "いまの σ" }]} formatY={(y) => y.toFixed(4)} formatTick={(y) => y.toFixed(1)} footer={<Tag d={d} />} />
            <div className="table-wrap">
              <table className="data">
                <caption>短期金利ボラティリティと発行体コール権</caption>
                <thead><tr><th scope="col" className="num">σ</th><th scope="col" className="num">Callable</th><th scope="col" className="num">コール権の価値</th></tr></thead>
                <tbody>{d.bond.by_volatility.map((r) => (
                  <tr key={r.volatility}><th scope="row" className="num">{pct(r.volatility, 1)}</th><td className="num">{f(r.callable, 6)}</td><td className="num">{f(r.issuer_call_value, 6)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        );
      }}
    </Need>
  );
}

/** II-8.6: grid and quadrature. */
export function GridTable() {
  return (
    <Need>
      {(d) => (
        <div className="table-wrap">
          <table className="data">
            <caption>格子・求積点を増やしたときの価格　<Tag d={d} /></caption>
            <thead><tr><th scope="col" className="num">格子の点</th><th scope="col" className="num">求積点</th><th scope="col" className="num">Callable</th>
              <th scope="col" className="num">Bullet の格子誤差</th><th scope="col" className="num">前の行との差</th></tr></thead>
            <tbody>{d.bond.grid_convergence.map((r) => (
              <tr key={r.points}><th scope="row" className="num">{r.points}</th><td className="num">{r.nodes}</td><td className="num" data-testid={`grid-${r.points}`}>{f(r.callable, 8)}</td>
                <td className="num">{r.bullet_grid_error.toExponential(2)}</td><td className="num">{r.change_from_previous == null ? "—" : r.change_from_previous.toExponential(2)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Need>
  );
}

/** II-8.8: prepayment by refinancing scenario. */
export function MbsScenarioPanel() {
  return (
    <Need>
      {(d) => {
        const m = d.mbs;
        const cpr = (k: "falling" | "flat" | "rising") => m.cpr.map((r) => ({ x: r.month / 12, y: 100 * r[k], date: `${r.month} か月` }));
        const pr = (k: "scheduled_principal" | "prepaid_principal") => m.flat_cashflows.map((r) => ({ x: r.month / 12, y: r[k], date: `${r.month} か月` }));
        return (
          <>
            <div className="table-wrap">
              <table className="data">
                <caption>借換え金利別の MBS のプリペイメントと元本回収期間（PSA {pct(m.pool.psa, 0)}、β = {m.pool.incentive}、k = {pct(m.pool.refinancing_cost, 2)}）　<Tag d={d} /></caption>
                <thead><tr><th scope="col">シナリオ</th><th scope="col" className="num">加重平均残存年数</th><th scope="col" className="num">固定 4% で割引</th>
                  <th scope="col" className="num">借換え金利 − 1% で割引</th><th scope="col" className="num">元本の合計</th></tr></thead>
                <tbody>{m.scenarios.map((r, i) => (
                  <tr key={r.scenario}><th scope="row">{r.scenario}</th><td className="num" data-testid={`wal-${i}`}>{f(r.weighted_average_life, 4)}</td>
                    <td className="num">{f(r.price_fixed_discount, 4)}</td><td className="num">{f(r.price_path_discount, 4)}</td><td className="num">{f(r.total_principal, 6)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="chart-pair">
              <LineChart title="借換え金利別の CPR（3年目から借換え金利が 3.5%・5%・6.5%）" origin="2026-01-01" xMin={0} xMax={30}
                xTicks={[0, 5, 10, 15, 20, 25, 30].map((x) => ({ x, label: String(x) }))} xLabel="経過年数" yLabel="CPR（%）"
                series={[
                  { key: "f", label: "借換え金利低下", color: "var(--series-1)", points: cpr("falling") },
                  { key: "c", label: "金利一定", color: "var(--series-3)", points: cpr("flat") },
                  { key: "r", label: "借換え金利上昇", color: "var(--series-2)", dashed: true, points: cpr("rising") },
                ]}
                formatY={(y) => `${y.toFixed(2)}%`} formatTick={(y) => `${y.toFixed(0)}%`} footer={<Tag d={d} />} />
              <LineChart title="金利一定のシナリオの毎月の元本：約定返済と期限前返済" origin="2026-01-01" xMin={0} xMax={30}
                xTicks={[0, 5, 10, 15, 20, 25, 30].map((x) => ({ x, label: String(x) }))} xLabel="経過年数" yLabel="額面100あたり"
                series={[
                  { key: "s", label: "約定返済", color: "var(--series-1)", points: pr("scheduled_principal") },
                  { key: "p", label: "期限前返済", color: "var(--series-2)", points: pr("prepaid_principal") },
                ]}
                formatY={(y) => y.toFixed(4)} formatTick={(y) => y.toFixed(2)} footer={<Tag d={d} />} />
            </div>
          </>
        );
      }}
    </Need>
  );
}

/** II-8.8: the pool on Hull-White paths. */
export function MbsPathsPanel() {
  return (
    <Need>
      {(d) => {
        const p = d.mbs.paths;
        const series = p.rates.map((r, i) => ({
          key: `p${i}`, label: i === 0 ? `短期金利（${p.count}経路）` : `経路 ${i + 1}`, inLegend: i === 0, color: "var(--series-1)", strokeWidth: 1, opacity: 0.6,
          points: r.map((y, k) => ({ x: (k + 1) / 12, y: 100 * y, date: `${k + 1} か月` })),
        }));
        return (
          <>
            <LineChart title={`Hull–White モデルによる短期金利の ${p.count} 経路（a = 15%、σ = 1.2%、初期 2%）`} origin="2026-01-01" xMin={0} xMax={30}
              xTicks={[0, 5, 10, 15, 20, 25, 30].map((x) => ({ x, label: String(x) }))} xLabel="経過年数" yLabel="短期金利（%）" tooltipRows={3}
              series={series} formatY={(y) => `${y.toFixed(3)}%`} formatTick={(y) => `${y.toFixed(0)}%`} footer={<Tag d={d} />} />
            <div className="tiles">
              <div className="tile emphasis"><div className="tile-label">{p.count} 経路の平均価格</div><div className="tile-value" data-testid="mbs-mean">{f(p.mean_price, 4)}</div>
                <div className="tile-note">平均の加重平均残存年数 {f(p.mean_wal, 3)} 年</div></div>
              <div className="tile"><div className="tile-label">{d.mbs.own_paths.count.toLocaleString("ja-JP")} 経路の平均価格</div><div className="tile-value">{f(d.mbs.own_paths.mean_price, 4)}</div>
                <div className="tile-note">標準誤差 {f(d.mbs.own_paths.standard_error, 4)}（経路を増やした参考値）</div></div>
            </div>
          </>
        );
      }}
    </Need>
  );
}

/** II-8.8.1: static spreads by PSA, and the price along the spread. */
export function StaticOasPanel() {
  return (
    <Need>
      {(d) => {
        const s = d.static;
        const pt = (psa: number) => s.price_curve.filter((r) => r.psa_percent === psa).map((r) => ({ x: r.spread_bp, y: r.price, date: `スプレッド ${r.spread_bp} bp` }));
        const cell = (psa: number, price: number) => s.table.find((r) => r.psa_percent === psa && r.assumed_price === price)!.oas_bp;
        return (
          <>
            <div className="table-wrap">
              <table className="data">
                <caption>PSA と架空の取引価格に対応する静的 OAS（bp）　<Tag d={d} /></caption>
                <thead><tr><th scope="col" className="num">PSA</th><th scope="col" className="num">価格 95（ディスカウント）</th><th scope="col" className="num">価格 105（プレミアム）</th></tr></thead>
                <tbody>{[0, 50, 100].map((psa) => (
                  <tr key={psa}><th scope="row" className="num">{psa}%</th><td className="num" data-testid={`oas-${psa}-95`}>{f(cell(psa, 95), 3)}</td><td className="num">{f(cell(psa, 105), 3)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <LineChart title="スプレッドと価格（PSA 別、固定 4% のゼロ金利にスプレッドを加えて割引）" origin="2026-01-01" xMin={-200} xMax={300}
              xTicks={[-200, -100, 0, 100, 200, 300].map((x) => ({ x, label: String(x) }))} xLabel="スプレッド（bp）" yLabel="価格（額面100）"
              series={[
                { key: "0", label: "PSA 0%", color: "var(--series-1)", points: pt(0) },
                { key: "50", label: "PSA 50%", color: "var(--series-3)", points: pt(50) },
                { key: "100", label: "PSA 100%", color: "var(--series-2)", dashed: true, points: pt(100) },
              ]}
              formatY={(y) => y.toFixed(3)} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
          </>
        );
      }}
    </Need>
  );
}
