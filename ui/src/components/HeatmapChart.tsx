import { useLayoutEffect, useRef, useState } from "react";

// A heat map on two numeric axes, colored around zero: green above, red below, the opacity from the value over the scale. Every cell
// is a point that was valued beforehand; a cell can be selected (click, or Enter / Space on the focused cell).

interface Props {
  title: string;
  xs: number[]; // columns, left to right
  ys: number[]; // rows, the largest at the top
  value: (xi: number, yi: number) => number;
  /** The value that has the full color (the same for every cell, and the same while the selection moves). */
  scale: number;
  selected: { xi: number; yi: number } | null;
  onSelect: (xi: number, yi: number) => void;
  formatCell: (v: number) => string;
  formatX: (x: number) => string;
  formatY: (y: number) => string;
  xLabel: string;
  yLabel: string;
  unit: string; // of the cell texts, for the caption
  testId: string;
  plusColor?: string;
  minusColor?: string;
}

const MARGIN = { top: 24, right: 12, bottom: 46, left: 64 };

export function HeatmapChart({ title, xs, ys, value, scale, selected, onSelect, formatCell, formatX, formatY, xLabel, yLabel, unit, testId,
  plusColor = "var(--series-3)", minusColor = "var(--critical)" }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(520);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.max(280, Math.floor(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const innerW = width - MARGIN.left - MARGIN.right;
  const cw = innerW / xs.length, ch = Math.max(30, Math.min(44, 220 / ys.length));
  const innerH = ch * ys.length;
  const height = MARGIN.top + innerH + MARGIN.bottom;
  const rows = [...ys.keys()].reverse(); // the largest y at the top
  return (
    <figure className="chart" ref={ref} data-testid={testId}>
      <figcaption className="chart-title">{title}</figcaption>
      <ul className="legend" aria-label="凡例">
        <li><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="2" fill={plusColor} /></svg>プラス</li>
        <li><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="2" fill={minusColor} /></svg>マイナス</li>
        <li>セルの数字：{unit}、濃さ：最大 {formatCell(scale)}</li>
      </ul>
      <div className="chart-body">
        <svg width={width} height={height} role="grid" aria-label={`${title}（縦軸：${yLabel}、横軸：${xLabel}）`}>
          {rows.map((yi, r) => (
            <g key={yi} role="row">
              <text className="tick" x={MARGIN.left - 8} y={MARGIN.top + r * ch + ch / 2} dy="0.32em" textAnchor="end">{formatY(ys[yi])}</text>
              {xs.map((x, xi) => {
                const v = value(xi, yi);
                const on = selected?.xi === xi && selected?.yi === yi;
                const opacity = Math.min(Math.abs(v) / (scale || 1), 1) * 0.9;
                return (
                  <g key={x} role="gridcell">
                    <rect x={MARGIN.left + xi * cw + 1} y={MARGIN.top + r * ch + 1} width={cw - 2} height={ch - 2} rx="3" fill="var(--surface-2)" />
                    <rect x={MARGIN.left + xi * cw + 1} y={MARGIN.top + r * ch + 1} width={cw - 2} height={ch - 2} rx="3" fill={v >= 0 ? plusColor : minusColor} fillOpacity={opacity}
                      stroke={on ? "var(--text-primary)" : "none"} strokeWidth="2" tabIndex={0} role="button" style={{ cursor: "pointer", outline: "none" }}
                      aria-label={`${xLabel} ${formatX(x)}、${yLabel} ${formatY(ys[yi])}：${formatCell(v)} ${unit}`} aria-pressed={on} data-testid={`${testId}-${xi}-${yi}`} data-value={v}
                      onClick={() => onSelect(xi, yi)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(xi, yi); } }} />
                    <text className="tick" x={MARGIN.left + xi * cw + cw / 2} y={MARGIN.top + r * ch + ch / 2} dy="0.32em" textAnchor="middle" pointerEvents="none"
                      style={{ fill: "var(--text-primary)", fontSize: 11, fontWeight: 600 }}>{formatCell(v)}</text>
                  </g>
                );
              })}
            </g>
          ))}
          {xs.map((x, xi) => <text key={x} className="tick" x={MARGIN.left + xi * cw + cw / 2} y={MARGIN.top + innerH + 16} textAnchor="middle">{formatX(x)}</text>)}
          <text className="axis-label" x={MARGIN.left} y={MARGIN.top - 8}>{yLabel}</text>
          <text className="axis-label" x={width - MARGIN.right} y={height - 6} textAnchor="end">{xLabel}</text>
        </svg>
      </div>
    </figure>
  );
}
