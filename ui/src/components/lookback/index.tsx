import { useState } from "react";
import { fetchLookback, type LookbackRequest } from "../../api/p16";
import { LineChart } from "../LineChart";
import { CallState, Choice, Num, Status, Tag, Tile, f, metaLine, sign, useCall, useSummary } from "../p16Common";

// Chapter 13.2: the lookback option. The live part asks rmql for one point (the closed form of the continuously monitored
// option and the tree of the discretely monitored one); the convergence study is saved (server/data/p16/lookback_convergence.json).

const GREEKS: [keyof import("../../api/p16").LookbackGreeks, string][] = [
  ["value", "価値"], ["delta", "デルタ（∂/∂S）"], ["gamma", "ガンマ"], ["vega", "ベガ（∂/∂σ、1.00 あたり）"], ["rho", "ロー（∂/∂r）"],
  ["dividend_rho", "配当ロー（∂/∂q）"], ["theta", "シータ（∂/∂t）"], ["strike_sensitivity", "行使価格の感応度"], ["extremum_sensitivity", "最小値（最大値）の感応度"],
];

export function LookbackLive() {
  const [type, setType] = useState<"floating" | "fixed">("floating");
  const [kind, setKind] = useState<"call" | "put">("call");
  const [spot, setSpot] = useState(100);
  const [offset, setOffset] = useState(0); // the running minimum (maximum) as a distance from the spot, in % of the spot
  const [strike, setStrike] = useState(100);
  const [rate, setRate] = useState(3);
  const [div, setDiv] = useState(1);
  const [vol, setVol] = useState(25);
  const [time, setTime] = useState(1);
  const [count, setCount] = useState(12);
  const [steps, setSteps] = useState(360);
  const minTracked = (type === "floating") === (kind === "call");
  const extremum = spot * (1 + (minTracked ? -1 : 1) * offset / 100);
  const request: LookbackRequest = {
    lookbackType: type, optionType: kind, spot, runningExtremum: Number(extremum.toPrecision(12)), strike: type === "fixed" ? strike : undefined,
    ratePct: rate, dividendYieldPct: div, volatilityPct: vol, time, monitoringCount: count, steps,
  };
  const call = useCall(request, (r, o) => fetchLookback(r, o));
  const d = call.data;
  return (
    <>
      <div className="controls" role="group" aria-label="ルックバックの入力" data-section="lookback">
        <Choice label="種類" value={type} options={[["floating", "変動ストライク"], ["fixed", "固定ストライク"]]} onChange={setType} />
        <Choice label="コール・プット" value={kind} options={[["call", "コール"], ["put", "プット"]]} onChange={setKind} />
        <Num label="現物" value={spot} min={1} max={1000} step={5} onChange={setSpot} width="5em" />
        <label>{minTracked ? "これまでの最小値" : "これまでの最大値"}（現物から {offset}%）{" "}
          <input type="range" min={0} max={30} step={1} value={offset} aria-label="これまでの最小値（最大値）の現物からの距離（%）" onChange={(e) => setOffset(Number(e.target.value))} />
          {" "}<strong>{f(extremum, 2)}</strong>
        </label>
        {type === "fixed" ? <Num label="行使価格" value={strike} min={1} max={1000} step={5} onChange={setStrike} width="5em" /> : null}
        <Num label="金利（%）" value={rate} min={-5} max={30} step={0.25} onChange={setRate} width="5em" />
        <Num label="配当利回り（%）" value={div} min={-5} max={30} step={0.25} onChange={setDiv} width="5em" />
        <Num label="ボラティリティ（%）" value={vol} min={1} max={200} step={1} onChange={setVol} width="5em" />
        <Num label="満期（年）" value={time} min={0.05} max={30} step={0.25} onChange={setTime} width="5em" />
        <Num label="監視の回数（0 は連続のみ）" value={count} min={0} max={steps} step={1} onChange={setCount} width="5em" />
        <Num label="木の段数" value={steps} min={2} max={400} step={12} onChange={setSteps} width="5em" />
        <CallState call={call} />
      </div>
      <Status call={call} label="" />
      {d ? (
        <>
          <div className="tiles">
            <Tile emphasis label="連続監視の価値（閉じた式）" value={f(d.continuous.value, 4)} testId="lookback-continuous" note={d.conventions.continuous} />
            <Tile label={`離散監視の価値（${d.inputs.monitoringCount} 回、木 ${d.inputs.steps} 段）`} value={d.discrete ? f(d.discrete.value, 4) : "—"} testId="lookback-discrete"
              note={d.discrete ? `連続との差 ${sign(d.discrete.value - d.continuous.value, 4)}。監視が少ないほど最小値（最大値）の更新が減り、価値は小さい` : "監視の回数を 1 以上にすると求める"} />
          </div>
          <div className="table-wrap">
            <table className="data">
              <caption>価値とグリークス　<Tag id={d.response.request_id} /></caption>
              <thead><tr><th scope="col">項目</th><th scope="col" className="num">連続監視</th><th scope="col" className="num">離散監視</th></tr></thead>
              <tbody>
                {GREEKS.map(([k, label]) => (
                  <tr key={k}><th scope="row">{label}</th><td className="num">{f(d.continuous[k], 5)}</td><td className="num">{d.discrete ? f(d.discrete[k], 5) : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">{d.conventions.discrete}。段数が監視回数の倍数のとき、監視日が段の上に正確に乗る（既定は 360 段、12 回）。</p>
        </>
      ) : null}
    </>
  );
}

/** The saved convergence of the tree to the closed form, and the Monte Carlo of a monthly monitoring. */
export function LookbackConvergence() {
  const s = useSummary();
  const d = s.data?.lookback_convergence;
  if (!d) return <Status call={s} label="" />;
  const kinds: ["call" | "put", string, string][] = [["call", "コール", "var(--series-1)"], ["put", "プット", "var(--series-2)"]];
  const steps = d.every_step.call.steps;
  return (
    <>
      <LineChart
        title="毎段で監視する木の誤差（連続監視の閉じた式 − 木の値）" origin="2026-11-02" xMin={0} xMax={1700}
        xTicks={steps.map((x) => ({ x, label: String(x) }))} xLabel="段数" yLabel="誤差" zeroLine
        series={kinds.map(([k, label, color]) => ({ key: k, label, color, points: steps.map((x, i) => ({ x, y: d.every_step[k].error[i], date: "2026-11-02" })), dots: steps.map((x, i) => ({ x, y: d.every_step[k].error[i], date: "2026-11-02" })) }))}
        formatY={(y) => y.toFixed(4)} formatTick={(y) => y.toFixed(2)} footer={<span className="muted">{metaLine(d.meta)}</span>}
      />
      <div className="table-wrap">
        <table className="data">
          <caption>誤差 × √段数 はほぼ一定である（誤差は 1/√段数 で減る）。1/√段数 の外挿では、誤差が約 1/50 になる</caption>
          <thead><tr><th scope="col">段数</th>{kinds.map(([, label]) => <th key={label} scope="col" className="num">{label}の誤差 × √段数</th>)}</tr></thead>
          <tbody>{steps.map((n, i) => <tr key={n}><th scope="row">{n}</th>{kinds.map(([k]) => <td key={k} className="num">{f(d.every_step[k].error_times_sqrt_steps[i], 3)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption>月次（12 回）の監視：木の外挿値と、独立なモンテカルロ（{d.monthly.call.monte_carlo_pairs.toLocaleString("ja-JP")} 対の対称変量）</caption>
          <thead><tr><th scope="col">種類</th><th scope="col" className="num">木（1200 段）</th><th scope="col" className="num">木（2400 段）</th><th scope="col" className="num">外挿</th><th scope="col" className="num">モンテカルロ ± 標準誤差</th><th scope="col" className="num">差（標準誤差）</th></tr></thead>
          <tbody>{kinds.map(([k, label]) => {
            const m = d.monthly[k];
            return <tr key={k}><th scope="row">{label}</th><td className="num">{f(m.tree_1200, 4)}</td><td className="num">{f(m.tree_2400, 4)}</td><td className="num">{f(m.extrapolated, 4)}</td>
              <td className="num">{f(m.monte_carlo, 4)} ± {f(m.monte_carlo_standard_error, 4)}</td><td className="num">{sign(m.difference_in_standard_errors, 2)}</td></tr>;
          })}</tbody>
        </table>
      </div>
      <p className="note">差は、外挿の誤差とモンテカルロの誤差の両方を含む（連続監視の閉じた式は {f(d.every_step.call.continuous, 4)}（コール）、{f(d.every_step.put.continuous, 4)}（プット））。</p>
    </>
  );
}
