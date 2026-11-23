import { useState } from "react";
import { fetchMbsState, type MbsRequest } from "../../api/mbsPrdc";
import { LineChart } from "../LineChart";
import { CallState, Num, Status, Tag, Tile, f, metaLine, sign, useCall, useMbsPrdcSummary } from "../p16Common";

// Chapters 14.2 and 14.3: the pass-through MBS. The state is the balance, which the borrowers' prepayment shrinks faster than the
// schedule when rates fall; the page shows the balance and the prepayment speed along refinancing-rate paths, and the price and
// the option-adjusted spread over Hull-White paths. The numbers are rmql's.

const SCENARIO_LABEL = { down: "借換え金利が下がる", flat: "借換え金利が一定", up: "借換え金利が上がる" } as const;
const SCENARIO_COLOR = { down: "var(--series-1)", flat: "var(--text-muted)", up: "var(--series-2)" } as const;
const DATE = "2026-11-02";

export function MbsLive() {
  const [months, setMonths] = useState(360);
  const [mortgage, setMortgage] = useState(5);
  const [pass, setPass] = useState(4.5);
  const [psa, setPsa] = useState(100);
  const [incentive, setIncentive] = useState(20);
  const [cost, setCost] = useState(0.5);
  const [start, setStart] = useState(4);
  const [slope, setSlope] = useState(0.5);
  const [paths, setPaths] = useState(100);
  const [price, setPrice] = useState(105);
  const request: MbsRequest = {
    pool: { balance: 100, mortgageRatePct: mortgage, passThroughRatePct: Math.min(pass, mortgage), months, psaPct: psa, incentive, refiCostPct: cost },
    refinanceStartPct: start, slopePct: slope, mc: { paths, seed: 48, assumedPrice: price },
  };
  const call = useCall(request, (r, o) => fetchMbsState(r, o));
  const d = call.data;
  const ticks = [0, 60, 120, 180, 240, 300, 360].filter((m) => m <= months).map((x) => ({ x, label: `${x / 12}年` }));
  const keys = ["down", "flat", "up"] as const;
  const series = (pick: (k: (typeof keys)[number]) => number[]) =>
    d ? keys.map((k) => ({ key: k, label: SCENARIO_LABEL[k], color: SCENARIO_COLOR[k], points: d.months.map((m, i) => ({ x: m - 1, y: pick(k)[i], date: DATE })) })) : [];
  return (
    <>
      <div className="controls" role="group" aria-label="MBS の入力" data-section="mbs">
        <Num label="返済月数" value={months} min={12} max={360} step={12} onChange={setMonths} width="5em" />
        <Num label="住宅ローン金利（%）" value={mortgage} min={0.5} max={20} step={0.25} onChange={setMortgage} width="5em" />
        <Num label="パススルー金利（%）" value={Math.min(pass, mortgage)} min={0} max={mortgage} step={0.25} onChange={setPass} width="5em" />
        <Num label="PSA（%）" value={psa} min={0} max={1000} step={25} onChange={setPsa} width="5em" />
        <Num label="借換えへの感応度" value={incentive} min={0} max={100} step={5} onChange={setIncentive} width="5em" />
        <Num label="借換え費用（%）" value={cost} min={0} max={5} step={0.25} onChange={setCost} width="5em" />
        <Num label="借換え金利の開始値（%）" value={start} min={0.25} max={15} step={0.25} onChange={setStart} width="5em" />
        <Num label="借換え金利の変化（%/年）" value={slope} min={0} max={3} step={0.25} onChange={setSlope} width="5em" />
        <Num label="Hull–White の経路数（偶数）" value={paths} min={2} max={200} step={2} onChange={(v) => setPaths(2 * Math.round(v / 2))} width="5em" />
        <Num label="OAS を求める価格" value={price} min={1} max={1000} step={1} onChange={setPrice} width="5em" />
        <CallState call={call} />
      </div>
      <Status call={call} label="" />
      {d ? (
        <>
          <LineChart title="元本残高（額面 100）：金利が下がるほど、早く減る" origin={DATE} xMin={0} xMax={months - 1} xTicks={ticks} xLabel="経過" yLabel="残高"
            series={series((k) => d.scenarios[k].balance)} formatY={(y) => y.toFixed(2)} formatTick={(y) => y.toFixed(0)} footer={<Tag id={d.response.request_id} />} />
          <LineChart title="期限前返済率 CPR（年率）：住宅ローン金利と借換え金利の差で決まる" origin={DATE} xMin={0} xMax={months - 1} xTicks={ticks} xLabel="経過" yLabel="CPR"
            series={series((k) => d.scenarios[k].cpr)} formatY={(y) => `${(100 * y).toFixed(2)}%`} formatTick={(y) => `${(100 * y).toFixed(0)}%`} zeroLine />
          <div className="table-wrap">
            <table className="data">
              <caption>借換え金利の 3 つの経路での価格と平均残存期間（短期金利 = 借換え金利 − 3%、各経路を 1 本として割り引く）</caption>
              <thead><tr><th scope="col">経路</th><th scope="col" className="num">価格</th><th scope="col" className="num">加重平均残存期間（年）</th></tr></thead>
              <tbody>{(["down", "flat", "up"] as const).map((k) => <tr key={k}><th scope="row">{SCENARIO_LABEL[k]}（{sign(d.scenarios[k].slope_pct_per_year, 2)}%/年）</th><td className="num" data-testid={`mbs-price-${k}`}>{f(d.scenarios[k].price, 4)}</td><td className="num">{f(d.scenarios[k].weighted_average_life, 2)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="tiles">
            <Tile emphasis label={`Hull–White ${d.monte_carlo.prices.length} 経路の平均価格`} value={f(d.monte_carlo.price, 4)} testId="mbs-mc-price" note={`標準誤差 ${f(d.monte_carlo.standard_error, 4)}。割引は OAS なし`} />
            <Tile label={`価格 ${d.monte_carlo.assumed_price} に合う OAS`} value={`${f(d.monte_carlo.oas_bp, 1)} bp`} testId="mbs-oas" note="すべての経路の割引に足す共通の幅。経路の平均価格が、この価格に一致する" />
          </div>
          <p className="note">{d.conventions.prepayment}。{d.conventions.discount}。{d.conventions.scenario}。</p>
        </>
      ) : null}
    </>
  );
}

/** The saved OAS against the number of paths: the estimate moves with the seed, and the spread over seeds falls with the paths. */
export function MbsOasConvergence() {
  const s = useMbsPrdcSummary();
  const d = s.data?.mbs_oas_convergence;
  if (!d) return <Status call={s} label="" />;
  return (
    <div className="table-wrap">
      <table className="data">
        <caption>OAS の推定値（bp）と、乱数の種による散らばり　<span className="muted">{metaLine(d.meta)}</span></caption>
        <thead><tr><th scope="col" className="num">経路数</th><th scope="col" className="num">種の数</th><th scope="col" className="num">OAS の平均</th><th scope="col" className="num">種による標準偏差</th><th scope="col" className="num">計算時間（秒）</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.paths}><td className="num">{r.paths.toLocaleString("ja-JP")}</td><td className="num">{r.seeds}</td><td className="num">{f(r.mean_oas_bp, 2)}</td><td className="num">{r.sd_oas_bp === null ? "—" : f(r.sd_oas_bp, 2)}</td><td className="num">{f(r.seconds, 2)}</td></tr>)}</tbody>
      </table>
      <p className="note">1 本の経路（金利が動かない場合）の静的スプレッドは {f(d.static_oas_bp, 1)} bp である。種の数が少ない行（特に 2〜3 個）の標準偏差は、目安にとどまる。</p>
    </div>
  );
}
