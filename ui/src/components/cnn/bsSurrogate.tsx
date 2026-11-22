import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchBsSummary, fetchBsSurrogate, type BsRequest, type BsSummary } from "../../api/bsSurrogate";
import { LineChart } from "../LineChart";
import { CallState, Num, Status, Tag, Tile, f, sign, useCall } from "../p16Common";

// Chapter 11.5: a fully connected network that learned the Black-Scholes call price. The answer is known, so the page sets the
// network's value and its derivative (the backward pass of 11.3, taken with respect to the input) against the closed form,
// inside and outside the range it was trained on. The training was done offline; the server runs the network forward.

const DATE = "2026-11-02";
const sci = (x: number) => x.toExponential(2);

let summaryPromise: Promise<BsSummary> | null = null;
function useBsSummary(): { data: BsSummary | null; error: string | null } {
  const [state, setState] = useState<{ data: BsSummary | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    summaryPromise ??= fetchBsSummary();
    let alive = true;
    summaryPromise.then((data) => alive && setState({ data, error: null })).catch((e: unknown) => {
      summaryPromise = null;
      if (alive) setState({ data: null, error: e instanceof ApiError ? e.message : String(e) });
    });
    return () => { alive = false; };
  }, []);
  return state;
}

/** One option: the network against the closed form, with a warning outside the training range. */
export function BsSurrogateLive() {
  const [spot, setSpot] = useState(100);
  const [strike, setStrike] = useState(100);
  const [rate, setRate] = useState(3);
  const [div, setDiv] = useState(1);
  const [vol, setVol] = useState(25);
  const [time, setTime] = useState(1);
  const request: BsRequest = { spot, strike, ratePct: rate, dividendYieldPct: div, volatilityPct: vol, time };
  const call = useCall(request, (r, o) => fetchBsSurrogate(r, o));
  const d = call.data;
  return (
    <>
      <div className="controls" role="group" aria-label="学習したネットワークの入力" data-section="bs-surrogate">
        <Num label="現物" value={spot} min={1} max={1000} step={5} onChange={setSpot} width="5em" />
        <Num label="行使価格" value={strike} min={1} max={1000} step={5} onChange={setStrike} width="5em" />
        <Num label="金利（%）" value={rate} min={-5} max={30} step={0.5} onChange={setRate} width="5em" />
        <Num label="配当利回り（%）" value={div} min={-5} max={30} step={0.5} onChange={setDiv} width="5em" />
        <Num label="ボラティリティ（%）" value={vol} min={1} max={200} step={5} onChange={setVol} width="5em" />
        <Num label="満期（年）" value={time} min={0.01} max={30} step={0.25} onChange={setTime} width="5em" />
        <CallState call={call} />
      </div>
      <Status call={call} label={d ? "学習はオフラインで実施済み。ネットワークの値は、保存した重みからの計算（R）、基準は rmql の閉じた式" : ""} />
      {d ? (
        <>
          {d.warnings.length ? (
            <div className="banner warn" role="status" data-testid="bs-warning">{d.warnings.map((w) => <div key={w}>{w}</div>)}</div>
          ) : null}
          <div className="tiles">
            <Tile emphasis label="ネットワークの価格" value={f(d.network.price, 4)} testId="bs-network-price" note={`rmql の閉じた式 ${f(d.exact.price, 4)}`} />
            <Tile label="価格の誤差（ネットワーク − 真の値）" value={sign(d.error.price, 4)} testId="bs-price-error" note={`相対 ${sign(100 * d.error.price_relative, 2)}%`} />
            <Tile label="ネットワークのデルタ（バックワード）" value={f(d.network.delta, 4)} testId="bs-network-delta" note={`rmql のデルタ ${f(d.exact.delta, 4)}、誤差 ${sign(d.error.delta, 4)}`} />
          </div>
          <p className="note">{d.conventions.network}。{d.conventions.delta}。基準：{d.conventions.exact}。　<Tag id={d.response.request_id} /></p>
        </>
      ) : null}
    </>
  );
}

/** The saved results: the learning curve, the curves along ln(S/K) and T, and the errors in and out of the range. */
export function BsSurrogateResults() {
  const { data: d, error } = useBsSummary();
  if (error) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {error}</div>;
  if (!d) return <p className="muted">計算中…</p>;
  const lo = d.settings.range_low, hi = d.settings.range_high;
  const pts = (grid: number[], ys: number[]) => grid.map((x, i) => ({ x, y: ys[i], date: DATE }));
  const m = d.curves.log_moneyness, t = d.curves.time;
  const mTicks = [-1, -0.5, 0, 0.5, 1].map((x) => ({ x, label: String(x) }));
  const tTicks = [0, 1, 2, 3, 4].map((x) => ({ x, label: String(x) }));
  const lc = d.learning_curve;
  const lcTicks = [0, 2000, 4000, 6000].map((x) => ({ x, label: String(x) }));
  return (
    <>
      <p className="note">学習：{d.settings.n_train.toLocaleString("ja-JP")} 点（rmql の閉じた式が教師）、検証 {d.settings.n_validation.toLocaleString("ja-JP")} 点、全結合 5-{d.settings.hidden}-{d.settings.hidden}-1（{d.settings.activation}）、{d.settings.optimizer}、{d.settings.epochs.toLocaleString("ja-JP")} エポック、乱数の種 {d.meta.seed}（rmql {d.meta.rmql_version}、{d.meta.generated.slice(0, 10)}）。
        勾配の数値チェック（解析的な勾配と中心差分の差、最大の成分に対する比）の最大は {sci(Math.max(...Object.values(d.gradient_check)))} でした。</p>
      <LineChart title="学習曲線（平均二乗誤差、C/K の単位）" origin={DATE} xMin={0} xMax={d.settings.epochs} xTicks={lcTicks} xLabel="エポック" yLabel="MSE"
        series={[
          { key: "tr", label: "学習", color: "var(--series-1)", points: lc.map((r) => ({ x: r.epoch, y: Math.log10(r.train_mse), date: DATE })) },
          { key: "va", label: "検証", color: "var(--series-2)", dashed: true, points: lc.map((r) => ({ x: r.epoch, y: Math.log10(r.validation_mse), date: DATE })) },
        ]}
        formatY={(y) => `1e${y.toFixed(1)}`} formatTick={(y) => `1e${y.toFixed(0)}`} />
      <LineChart title={`価格（C/K）：ln(S/K) の学習範囲は ${lo[0]}〜${hi[0]}。範囲の外で、ネットワークは真の値から離れる`} origin={DATE} xMin={-1} xMax={1} xTicks={mTicks} xLabel="ln(S/K)" yLabel="C / K"
        series={[
          { key: "ex", label: "rmql の閉じた式", color: "var(--text)", points: pts(m.grid, m.exact_price) },
          { key: "nn", label: "ネットワーク", color: "var(--series-1)", dashed: true, points: pts(m.grid, m.network_price) },
        ]}
        markers={[{ x: lo[0], label: "学習範囲の下限" }, { x: hi[0], label: "学習範囲の上限" }]}
        formatY={(y) => y.toFixed(3)} formatTick={(y) => y.toFixed(2)} footer={<span className="muted">他の入力は、満期 1 年、ボラティリティ 25%、金利 3%、配当 1%</span>} />
      <LineChart title="デルタ：ネットワークの入力に対する微分（バックワード）と、真のデルタ" origin={DATE} xMin={-1} xMax={1} xTicks={mTicks} xLabel="ln(S/K)" yLabel="デルタ"
        series={[
          { key: "ex", label: "rmql のデルタ", color: "var(--text)", points: pts(m.grid, m.exact_delta) },
          { key: "nn", label: "ネットワークのデルタ", color: "var(--series-2)", dashed: true, points: pts(m.grid, m.network_delta) },
        ]}
        markers={[{ x: lo[0], label: "学習範囲の下限" }, { x: hi[0], label: "学習範囲の上限" }]}
        formatY={(y) => y.toFixed(3)} formatTick={(y) => y.toFixed(2)} />
      <LineChart title={`価格（C/K）を満期に対して：学習範囲は ${lo[1]}〜${hi[1]} 年`} origin={DATE} xMin={0} xMax={4} xTicks={tTicks} xLabel="満期（年）" yLabel="C / K"
        series={[
          { key: "ex", label: "rmql の閉じた式", color: "var(--text)", points: pts(t.grid, t.exact_price) },
          { key: "nn", label: "ネットワーク", color: "var(--series-1)", dashed: true, points: pts(t.grid, t.network_price) },
        ]}
        markers={[{ x: lo[1], label: "下限" }, { x: hi[1], label: "上限" }]} formatY={(y) => y.toFixed(3)} formatTick={(y) => y.toFixed(2)} />
      <div className="table-wrap">
        <table className="data">
          <caption>誤差（C/K の単位。価格の RMSE と最大絶対誤差、デルタの RMSE と最大絶対誤差）。範囲の中は検証に使っていない {d.settings.n_test.toLocaleString("ja-JP")} 点、外は 1 つの入力だけ範囲を外した 3,000 点</caption>
          <thead><tr><th scope="col">集合</th><th scope="col" className="num">価格 RMSE</th><th scope="col" className="num">価格の最大誤差</th><th scope="col" className="num">デルタ RMSE</th><th scope="col" className="num">デルタの最大誤差</th></tr></thead>
          <tbody>{d.errors.map((e) => <tr key={e.set}><th scope="row">{e.label}</th><td className="num">{sci(e.price_rmse)}</td><td className="num">{sci(e.price_max_abs)}</td><td className="num">{sci(e.delta_rmse)}</td><td className="num">{sci(e.delta_max_abs)}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
