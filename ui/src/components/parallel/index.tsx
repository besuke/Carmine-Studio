import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { fetchParallel, type BatchInputs, type ParallelResponse } from "../../api/parallel";
import { LineChart } from "../LineChart";
import { FlowChart } from "../FlowChart";

// Components of the parallel computing chapter (Coral-Book III-1). The reader chooses the number of bonds and the
// largest number of threads, and the server measures the batch.

const DEFAULT: BatchInputs = { count: 10000, maxThreads: 8 };
interface PState { data: ParallelResponse | null; loading: boolean; error: string | null; req: BatchInputs; set: (p: Partial<BatchInputs>) => void; again: () => void }
const Ctx = createContext<PState | null>(null);

export function ParallelProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState(DEFAULT);
  const [run, setRun] = useState(0);
  const [data, setData] = useState<ParallelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      fetchParallel({ batch: req }, { signal: c.signal })
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof ApiError ? e.message : String(e));
          setLoading(false);
        });
    }, 300);
    return () => { c.abort(); window.clearTimeout(timer.current); };
  }, [req, run]);
  return <Ctx.Provider value={{ data, loading, error, req, set: (p) => setReq((x) => ({ ...x, ...p })), again: () => setRun((k) => k + 1) }}>{children}</Ctx.Provider>;
}
function useP(): PState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useP must be used inside ParallelProvider");
  return s;
}
function Need({ children }: { children: (d: ParallelResponse) => ReactNode }) {
  const { data, error } = useP();
  if (data) return <>{children(data)}</>;
  if (error) return <p className="muted">（直前の入力では計算できません。値を戻してください）</p>;
  return <p className="muted">計算中…</p>;
}
const Tag = ({ d }: { d: ParallelResponse }) => <span className="response-tag" data-request-id={data_id(d)}>API応答 <code>{data_id(d)}</code></span>;
const data_id = (d: ParallelResponse) => d.response.request_id;
const f = (x: number, n: number) => x.toFixed(n);
const t3 = (x: number) => (Math.trunc(x * 1000) / 1000).toFixed(3);

export function ParallelStatus() {
  const { error, loading } = useP();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{loading ? "計測中…" : ""}</p>;
}

/** III-1.4: the six scenarios, one independent task per row. */
export function ExampleTable() {
  return (
    <Need>
      {(d) => (
        <div className="table-wrap">
          <table className="data">
            <caption>6つのシナリオの現在価値（各行が独立したタスク）　<Tag d={d} /></caption>
            <thead><tr><th scope="col" className="num">scenario_ID</th><th scope="col" className="num">cashflow</th><th scope="col" className="num">discount_rate</th>
              <th scope="col" className="num">maturity</th><th scope="col" className="num">present_value</th></tr></thead>
            <tbody>{d.example.map((r) => (
              <tr key={r.scenario_ID}><th scope="row" className="num">{r.scenario_ID}</th><td className="num">{f(r.cashflow, 0)}</td><td className="num">{f(r.discount_rate, 3)}</td>
                <td className="num">{f(r.maturity, 0)}</td><td className="num" data-testid={`pv-${r.scenario_ID}`}>{f(r.present_value, 10)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Need>
  );
}

export function BatchControls() {
  const { req, set, again, loading, data, error } = useP();
  return (
    <div className="controls" role="group" aria-label="一括計算の条件" data-section="batch">
      <label>債券の件数{" "}
        <select value={req.count} aria-label="一括計算：件数" onChange={(e) => set({ count: Number(e.target.value) })}>
          {[1000, 5000, 10000, 20000].map((n) => <option key={n} value={n}>{n.toLocaleString("ja-JP")}</option>)}
        </select>
      </label>
      <label>スレッド数の上限{" "}
        <select value={req.maxThreads} aria-label="一括計算：スレッド数の上限" onChange={(e) => set({ maxThreads: Number(e.target.value) })}>
          {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <button type="button" onClick={again} disabled={loading}>もう一度測る</button>
      <span className="controls-state">{loading ? "サーバーで計測中…" : error ? <span className="error-text">{error}</span> : data ? <span className="response-tag" data-request-id={data.response.request_id}>API応答 <code>{data.response.request_id}</code></span> : null}</span>
    </div>
  );
}

/** III-1.5–1.6: time and speed-up by threads, and the identical results. */
export function TimingPanel() {
  return (
    <Need>
      {(d) => {
        const t = d.batch.timing;
        const xs = t.map((r) => r.threads);
        const sp = t.map((r) => ({ x: r.threads, y: r.speedup, date: `${r.threads} スレッド` }));
        const ideal = t.map((r) => ({ x: r.threads, y: r.threads, date: `${r.threads} スレッド` }));
        return (
          <>
            <div className="tiles">
              <div className="tile emphasis"><div className="tile-label">{d.batch.count.toLocaleString("ja-JP")} 件の評価時間（1 → {xs[xs.length - 1]} スレッド）</div>
                <div className="tile-value" data-testid="time-range">{f(t[0].seconds, 2)} 秒 → {f(t[t.length - 1].seconds, 2)} 秒</div>
                <div className="tile-note">最大の速さ {f(Math.max(...t.map((r) => r.speedup)), 1)} 倍</div></div>
              <div className="tile"><div className="tile-label">スレッド数による結果の違い</div><div className="tile-value" data-testid="max-diff">{Math.max(...t.map((r) => r.max_abs_diff_from_one_thread)) === 0 ? "差 0" : Math.max(...t.map((r) => r.max_abs_diff_from_one_thread)).toExponential(2)}</div>
                <div className="tile-note">単価・経過利子・デュレーション・コンベクシティ・BPV</div></div>
              <div className="tile"><div className="tile-label">このサーバーの論理プロセッサ</div><div className="tile-value">{d.machine.logical_processors}</div><div className="tile-note">{d.machine.r_version}</div></div>
            </div>
            <div className="table-wrap">
              <table className="data">
                <caption>スレッド数と評価時間（債券 {d.batch.count.toLocaleString("ja-JP")} 件、このサーバーでの実測）　<Tag d={d} /></caption>
                <thead><tr><th scope="col" className="num">スレッド数</th><th scope="col" className="num">時間（秒）</th><th scope="col" className="num">件／秒</th>
                  <th scope="col" className="num">1スレッドとの速さの比</th><th scope="col" className="num">1スレッドとの結果の差</th></tr></thead>
                <tbody>{t.map((r) => (
                  <tr key={r.threads}><th scope="row" className="num">{r.threads}</th><td className="num">{f(r.seconds, 3)}</td><td className="num">{Math.round(r.bonds_per_second).toLocaleString("ja-JP")}</td>
                    <td className="num">{f(r.speedup, 2)}</td><td className="num">{r.max_abs_diff_from_one_thread === 0 ? "0" : r.max_abs_diff_from_one_thread.toExponential(2)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="chart-pair">
              <LineChart title="スレッド数と速さの比（点線は、スレッド数どおりに速くなる理想）" origin="2026-01-01" xMin={1} xMax={xs[xs.length - 1]}
                xTicks={xs.map((x) => ({ x, label: String(x) }))} xLabel="スレッド数" yLabel="1スレッドに対する速さ（倍）"
                series={[{ key: "s", label: "実測", color: "var(--series-1)", points: sp, dots: sp }, { key: "i", label: "理想", color: "var(--text-muted)", dashed: true, points: ideal }]}
                formatY={(y) => `${y.toFixed(2)} 倍`} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
              <FlowChart title="スレッド数ごとの評価時間" origin="2026-01-01" xMin={0.5} xMax={xs.length + 0.5} barWidth={0.6} yLabel="秒" legend={false}
                xTicks={xs.map((x, i) => ({ x: i + 1, label: `${x} スレッド` }))}
                series={[{ key: "t", label: "時間", color: "var(--series-1)" }]}
                bars={t.map((r, i) => ({ x: i + 1, value: r.seconds, series: "t", date: `${r.threads} スレッド`, label: "時間（秒）" }))}
                formatY={(y) => y.toFixed(2)} footer={<Tag d={d} />} />
            </div>
          </>
        );
      }}
    </Need>
  );
}

/** What was computed: the bond's price along the yields of the batch. */
export function BatchResultChart() {
  return (
    <Need>
      {(d) => {
        const pts = d.batch.price_by_yield.map((r) => ({ x: 100 * r.yield, y: r.clean_price, date: `複利利回り ${f(100 * r.yield, 3)}%` }));
        return (
          <div className="two-col">
            <LineChart title={`一括で評価した ${d.batch.count.toLocaleString("ja-JP")} 件の単価（60 件を抜き出して表示）`} origin="2026-01-01" xMin={0} xMax={3}
              xTicks={[0, 0.5, 1, 1.5, 2, 2.5, 3].map((x) => ({ x, label: `${x}%` }))} xLabel="複利利回り" yLabel="単価"
              series={[{ key: "p", label: "単価", color: "var(--series-1)", points: pts }]} formatY={(y) => y.toFixed(4)} formatTick={(y) => y.toFixed(0)} footer={<Tag d={d} />} />
            <div className="table-wrap">
              <table className="data">
                <caption>評価結果の一部</caption>
                <thead><tr><th scope="col" className="num">複利利回り</th><th scope="col" className="num">単価</th><th scope="col" className="num">修正デュレーション</th><th scope="col" className="num">BPV</th></tr></thead>
                <tbody>{d.batch.sample.map((r) => (
                  <tr key={r.yield}><th scope="row" className="num">{t3(100 * r.yield)}%</th><td className="num">{f(r.clean_price, 6)}</td><td className="num">{t3(r.duration_modified)}</td>
                    <td className="num">{r.basis_point_value.toExponential(4)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        );
      }}
    </Need>
  );
}
