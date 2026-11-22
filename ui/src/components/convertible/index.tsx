import { useState } from "react";
import { fetchConvertible, type CallabilityRequest, type ConvertibleRequest } from "../../api/p16";
import { LineChart } from "../LineChart";
import { CallState, Choice, Num, Status, Tag, Tile, f, metaLine, sign, useCall, useSummary } from "../p16Common";

// Chapter 13.3: the convertible bond (a lattice of the value and of the probability of conversion, with the credit spread on the
// part that is not converted). The live part values one bond with rmql; the curve along the share price is saved.

const GREEKS: [keyof import("../../api/p16").ConvertibleGreeks, string][] = [
  ["value", "価値"], ["delta", "デルタ（∂/∂S）"], ["gamma", "ガンマ"], ["vega", "ベガ（∂/∂σ、1.00 あたり）"], ["rho", "ロー（∂/∂r）"],
  ["dividend_rho", "配当ロー（∂/∂q）"], ["credit_spread_sensitivity", "信用スプレッドの感応度（∂/∂s）"],
];

export function ConvertibleLive() {
  const [years, setYears] = useState(5);
  const [coupon, setCoupon] = useState(2);
  const [ratio, setRatio] = useState(1);
  const [exercise, setExercise] = useState<"european" | "american">("american");
  const [callOn, setCallOn] = useState(false);
  const [callYears, setCallYears] = useState(3);
  const [callPrice, setCallPrice] = useState(108);
  const [spot, setSpot] = useState(100);
  const [rate, setRate] = useState(3);
  const [div, setDiv] = useState(1);
  const [vol, setVol] = useState(25);
  const [spread, setSpread] = useState(2);
  const [steps, setSteps] = useState(200);
  const callabilities: CallabilityRequest[] = callOn ? [{ years: Math.min(callYears, years), kind: "call", price: callPrice, priceType: "dirty" }] : [];
  const request: ConvertibleRequest = {
    bond: { remainingYears: years, couponPct: coupon, redemption: 100 }, conversion: { kind: "fixed", ratio }, exercise, callabilities,
    market: { spot, ratePct: rate, dividendYieldPct: div, volatilityPct: vol, creditSpreadPct: spread }, steps,
  };
  const call = useCall(request, (r, o) => fetchConvertible(r, o));
  const d = call.data;
  const conversion = spot * ratio;
  return (
    <>
      <div className="controls" role="group" aria-label="転換社債の入力" data-section="convertible">
        <Num label="残存年数" value={years} min={1} max={30} step={1} onChange={setYears} width="4em" />
        <Num label="クーポン（%）" value={coupon} min={0} max={20} step={0.25} onChange={setCoupon} width="5em" />
        <Num label="転換比率（額面 100 あたりの株数）" value={ratio} min={0.1} max={5} step={0.05} onChange={setRatio} width="5em" />
        <Choice label="転換できる時" value={exercise} options={[["american", "いつでも（アメリカン）"], ["european", "満期だけ（ヨーロピアン）"]]} onChange={setExercise} />
        <label><input type="checkbox" checked={callOn} onChange={(e) => setCallOn(e.target.checked)} aria-label="発行体のコールをつける" /> コール条項</label>
        {callOn ? <><Num label="コール日（年後）" value={callYears} min={0.5} max={years} step={0.5} onChange={setCallYears} width="4em" /><Num label="コール価格（経過利息を含む）" value={callPrice} min={50} max={200} step={1} onChange={setCallPrice} width="5em" /></> : null}
        <Num label="現物" value={spot} min={1} max={1000} step={5} onChange={setSpot} width="5em" />
        <Num label="金利（%）" value={rate} min={-5} max={30} step={0.25} onChange={setRate} width="5em" />
        <Num label="配当利回り（%）" value={div} min={-5} max={30} step={0.25} onChange={setDiv} width="5em" />
        <Num label="ボラティリティ（%）" value={vol} min={1} max={200} step={1} onChange={setVol} width="5em" />
        <Num label="信用スプレッド（%）" value={spread} min={0} max={50} step={0.25} onChange={setSpread} width="5em" />
        <Num label="木の段数" value={steps} min={2} max={300} step={10} onChange={setSteps} width="5em" />
        <CallState call={call} />
      </div>
      <Status call={call} label={d ? `計算エンジン：${d.conventions.engine}（R、HTTP API）` : ""} />
      {d ? (
        <>
          <div className="tiles">
            <Tile emphasis label="転換社債の価値" value={f(d.values.value, 4)} testId="cb-value" note={d.conventions.bond} />
            <Tile label="転換価値（株価 × 転換比率）" value={f(conversion, 4)} testId="cb-conversion" note={`価値との差 ${sign(d.values.value - conversion, 4)}（転換の選択権と、債券の下値の分）`} />
            <Tile label="デルタ" value={f(d.values.delta, 4)} note="株が 1 動いたときの価値の動き。0（債券に近い）から転換比率（株に近い）の間" />
          </div>
          <div className="table-wrap">
            <table className="data">
              <caption>グリークス（rmql）　<Tag id={d.response.request_id} /></caption>
              <thead><tr><th scope="col">項目</th><th scope="col" className="num">値</th></tr></thead>
              <tbody>{GREEKS.map(([k, label]) => <tr key={k}><th scope="row">{label}</th><td className="num">{f(d.values[k], 5)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="note">{d.conventions.method}。</p>
        </>
      ) : null}
    </>
  );
}

/** The saved curve: the value and the delta against the share price, with and without a call; the floors. */
export function ConvertibleCurve() {
  const s = useSummary();
  const c = s.data?.convertible_curve;
  if (!c) return <Status call={s} label="" />;
  const pts = (ys: number[]) => c.spots.map((x, i) => ({ x, y: ys[i], date: "2026-11-02" }));
  const ticks = [40, 60, 80, 100, 120, 140, 160].map((x) => ({ x, label: String(x) }));
  return (
    <>
      <LineChart
        title="転換社債の価値と、その下限（普通債）と転換価値" origin="2026-11-02" xMin={40} xMax={160} xTicks={ticks} xLabel="株価" yLabel="価値（額面 100）"
        series={[
          { key: "cb", label: "転換社債", color: "var(--series-1)", points: pts(c.convertible.value) },
          { key: "call", label: "コールつき", color: "var(--series-2)", dashed: true, points: pts(c.convertible_with_call.value) },
          { key: "conv", label: "転換価値", color: "var(--text-muted)", dashed: true, points: pts(c.conversion_value) },
          { key: "bond", label: "普通債（転換比率 0 の極限）", color: "var(--series-3)", dashed: true, points: pts(c.straight_bond) },
        ]}
        formatY={(y) => y.toFixed(2)} formatTick={(y) => y.toFixed(0)} footer={<span className="muted">{metaLine(c.meta)}</span>}
      />
      <LineChart
        title="デルタ：株価が低いと債券（0）、高いと株（転換比率 1）に近づく" origin="2026-11-02" xMin={40} xMax={160} xTicks={ticks} xLabel="株価" yLabel="デルタ" yRange={[0, 1.05]}
        series={[
          { key: "d", label: "転換社債", color: "var(--series-1)", points: pts(c.convertible.delta) },
          { key: "dc", label: "コールつき", color: "var(--series-2)", dashed: true, points: pts(c.convertible_with_call.delta) },
        ]}
        formatY={(y) => y.toFixed(3)} formatTick={(y) => y.toFixed(1)}
      />
      <p className="note">既定の債券：残存 5 年、クーポン 2%（半年ごと）、転換比率 1、アメリカン、信用スプレッド 2%、金利 3%、配当 1%、ボラティリティ 25%、100 段。コールは 3 年後、価格 108（経過利息を含む）。</p>
    </>
  );
}
