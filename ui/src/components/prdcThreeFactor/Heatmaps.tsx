import { useState } from "react";
import { HeatmapChart } from "../HeatmapChart";
import { PointPanel, useT } from "./index";
import type { HeatCell, HeatMapKey } from "../../api/prdcThreeFactor";

// Two heat maps over the scenario valuation (a coarse grid): the spot change against the volatility change, and the spot change against a
// parallel shift of the domestic or the foreign curve. The color is the full revaluation or the cross term that belongs to the map (the Vanna
// for the volatility, the cross-gamma of the chosen curve for the rate). A selected cell fills the table and the bubbles on the right.

type Metric = "full" | "cross";
type Side = "domestic" | "foreign";

const plus = (x: number) => (x > 0 ? `+${x}` : x < 0 ? `−${Math.abs(x)}` : "0");

export function ThreeFactorHeatmaps() {
  const { heat, heatLoading } = useT();
  const [metric, setMetric] = useState<Metric>("full");
  const [side, setSide] = useState<Side>("domestic");
  const [sel, setSel] = useState<{ map: "vol" | "rate"; xi: number; yi: number }>({ map: "vol", xi: 4, yi: 3 }); // +10 yen, +4 points
  if (!heat) return <p className="muted">{heatLoading ? "ヒートマップを計算中…（1秒ほど）" : "ヒートマップを描けませんでした"}</p>;
  const spots = heat.spot_values;
  const rateKey: HeatMapKey = side === "domestic" ? "rate_domestic" : "rate_foreign";
  const cellOf = (key: HeatMapKey, xi: number, yi: number): HeatCell => heat.maps[key].cells[xi * heat.maps[key].y_values.length + yi];
  const valueOf = (key: HeatMapKey, xi: number, yi: number) => {
    const c = cellOf(key, xi, yi);
    return metric === "full" ? c.full : key === "vol" ? c.cross.vanna : c.cross[side];
  };
  const scaleOf = (key: HeatMapKey) => {
    const m = heat.maps[key];
    let max = 1;
    for (let xi = 0; xi < spots.length; xi++) for (let yi = 0; yi < m.y_values.length; yi++) max = Math.max(max, Math.abs(valueOf(key, xi, yi)));
    return max;
  };
  const million = (v: number) => {
    const d = metric === "full" ? 1 : 2;
    const s = (Math.abs(v) / 1e6).toFixed(d);
    return Number(s) === 0 ? (0).toFixed(d) : `${v < 0 ? "−" : ""}${s}`;
  };
  const selKey: HeatMapKey = sel.map === "vol" ? "vol" : rateKey;
  const q = cellOf(selKey, sel.xi, sel.yi);
  const fixed = heat.maps[selKey].fixed;
  const bp = (x: number) => `${plus(x)}bp`;
  const caption = sel.map === "vol"
    ? <>FX スポット {plus(q.spotYen)} 円、FX ボラ {plus(q.y)} ポイント<br /><span className="muted">円金利 {bp(fixed.domesticBp)}、外貨金利 {bp(fixed.foreignBp)}</span></>
    : side === "domestic"
      ? <>FX スポット {plus(q.spotYen)} 円、円金利 {bp(q.y)}<br /><span className="muted">ボラ {plus(fixed.volPoints)} ポイント、外貨金利 {bp(fixed.foreignBp)}</span></>
      : <>FX スポット {plus(q.spotYen)} 円、外貨金利 {bp(q.y)}<br /><span className="muted">ボラ {plus(fixed.volPoints)} ポイント、円金利 {bp(fixed.domesticBp)}</span></>;
  const crossName = (key: HeatMapKey) => (key === "vol" ? "Vanna" : `クロスガンマ（${side === "domestic" ? "円金利" : "外貨金利"}）`);
  return (
    <div data-testid="tf-heat" aria-busy={heatLoading}>
      <div className="controls" role="group" aria-label="ヒートマップの表示">
        <span>色：</span>
        <label><input type="radio" name="heat-metric" checked={metric === "full"} onChange={() => setMetric("full")} data-testid="heat-metric-full" /> フル再評価損益</label>
        <label><input type="radio" name="heat-metric" checked={metric === "cross"} onChange={() => setMetric("cross")} data-testid="heat-metric-cross" /> 交差項の寄与（Vanna・クロスガンマ）</label>
        <span>金利：</span>
        <label><input type="radio" name="heat-side" checked={side === "domestic"} onChange={() => setSide("domestic")} data-testid="heat-side-domestic" /> 円金利</label>
        <label><input type="radio" name="heat-side" checked={side === "foreign"} onChange={() => setSide("foreign")} data-testid="heat-side-foreign" /> 外貨金利</label>
      </div>
      <div className="scenario-curve">
        <div>
          <HeatmapChart testId="heat-vol" title={metric === "full" ? "フル再評価損益：FX スポット × FX ボラ" : "Vanna の寄与：FX スポット × FX ボラ"}
            xs={spots} ys={heat.maps.vol.y_values} value={(xi, yi) => valueOf("vol", xi, yi)} scale={scaleOf("vol")}
            selected={sel.map === "vol" ? { xi: sel.xi, yi: sel.yi } : null} onSelect={(xi, yi) => setSel({ map: "vol", xi, yi })}
            formatCell={million} formatX={plus} formatY={plus} xLabel="FX スポットの変化（円）" yLabel="FX ボラの変化（ポイント）" unit="百万円" />
          <HeatmapChart testId="heat-rate" title={metric === "full" ? `フル再評価損益：FX スポット × ${side === "domestic" ? "円金利" : "外貨金利"}` : `${crossName(rateKey)}の寄与：FX スポット × ${side === "domestic" ? "円金利" : "外貨金利"}`}
            xs={spots} ys={heat.maps[rateKey].y_values} value={(xi, yi) => valueOf(rateKey, xi, yi)} scale={scaleOf(rateKey)}
            selected={sel.map === "rate" ? { xi: sel.xi, yi: sel.yi } : null} onSelect={(xi, yi) => setSel({ map: "rate", xi, yi })}
            formatCell={million} formatX={plus} formatY={plus} xLabel="FX スポットの変化（円）" yLabel={heat.maps[rateKey].y_label} unit="百万円" />
        </div>
        <PointPanel q={q} scale={heat.bubble_scale} caption={caption} testPrefix="tf-heat-point" />
      </div>
      <details><summary>定義</summary><p className="note">{heat.conventions.heatmap}　{heat.conventions.cross}</p></details>
    </div>
  );
}
