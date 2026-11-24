import { useLayoutEffect, useRef, useState } from "react";

// Lines over a numeric x-axis with a vertical line that can be dragged (or moved by the arrow keys). Every x is a point that was
// valued beforehand, so the selected index is always one of them and the page shows the numbers of that point at once.

export interface DragSeries {
  key: string;
  label: string;
  color: string; // CSS variable reference
  values: number[]; // one per x
  dashed?: boolean;
}

interface Props {
  title: string;
  xs: number[];
  series: DragSeries[];
  selected: number; // index into xs
  onSelect: (index: number) => void;
  xTicks: { x: number; label: string }[];
  xLabel: string;
  yLabel: string;
  formatY: (y: number) => string;
  formatTick?: (y: number) => string;
  /** The text of the selected x, for assistive technology. */
  valueText: (x: number) => string;
  height?: number;
}

const MARGIN = { top: 34, right: 16, bottom: 38, left: 64 };

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

export function DragLineChart({ title, xs, series, selected, onSelect, xTicks, xLabel, yLabel, formatY, formatTick, valueText, height = 300 }: Props) {
  const ref = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(520);
  const dragging = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.max(280, Math.floor(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.06 || 1;
  const yMin = lo - pad, yMax = hi + pad;
  const xMin = xs[0], xMax = xs[xs.length - 1];
  const innerW = width - MARGIN.left - MARGIN.right, innerH = height - MARGIN.top - MARGIN.bottom;
  const sx = (x: number) => MARGIN.left + ((x - xMin) / (xMax - xMin)) * innerW;
  const sy = (y: number) => MARGIN.top + (1 - (y - yMin) / (yMax - yMin)) * innerH;
  const path = (values: number[]) => values.map((v, i) => `${i === 0 ? "M" : "L"}${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");

  const indexAt = (clientX: number) => {
    const box = svgRef.current!.getBoundingClientRect();
    const x = xMin + ((clientX - box.left - MARGIN.left) / innerW) * (xMax - xMin);
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    return best;
  };
  const clamp = (i: number) => Math.max(0, Math.min(xs.length - 1, i));
  const key = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }[e.key];
    if (step !== undefined) { e.preventDefault(); onSelect(clamp(selected + step)); }
    else if (e.key === "Home") { e.preventDefault(); onSelect(0); }
    else if (e.key === "End") { e.preventDefault(); onSelect(xs.length - 1); }
  };
  const x0 = sx(xs[selected]);
  return (
    <figure className="chart" ref={ref} data-testid="drag-chart">
      <figcaption className="chart-title">{title}</figcaption>
      <ul className="legend" aria-label="凡例">
        {series.map((s) => (
          <li key={s.key}>
            <svg width="22" height="10" aria-hidden="true"><line x1="0" x2="22" y1="5" y2="5" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "5 3" : undefined} /></svg>
            {s.label}
          </li>
        ))}
      </ul>
      <div className="chart-body">
        <svg ref={svgRef} width={width} height={height} role="slider" tabIndex={0} aria-label={`${title}：縦線の位置（${xLabel}）`}
          aria-valuemin={xMin} aria-valuemax={xMax} aria-valuenow={xs[selected]} aria-valuetext={valueText(xs[selected])}
          style={{ touchAction: "none", cursor: "ew-resize", userSelect: "none" }} data-testid="drag-svg"
          onKeyDown={key}
          onPointerDown={(e) => { dragging.current = true; (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); onSelect(indexAt(e.clientX)); }}
          onPointerMove={(e) => { if (dragging.current) onSelect(indexAt(e.clientX)); }}
          onPointerUp={(e) => { dragging.current = false; (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); }}
          onPointerCancel={() => { dragging.current = false; }}>
          {niceTicks(yMin, yMax).map((t) => (
            <g key={t}>
              <line className="grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={sy(t)} y2={sy(t)} />
              <text className="tick" x={MARGIN.left - 8} y={sy(t)} dy="0.32em" textAnchor="end">{(formatTick ?? formatY)(t)}</text>
            </g>
          ))}
          {xTicks.map((t) => <text key={t.label} className="tick" x={sx(t.x)} y={height - MARGIN.bottom + 17} textAnchor="middle">{t.label}</text>)}
          <line className="axis" x1={MARGIN.left} x2={width - MARGIN.right} y1={sy(0)} y2={sy(0)} />
          {series.map((s) => <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "6 4" : undefined} strokeLinejoin="round" />)}
          <line x1={x0} x2={x0} y1={MARGIN.top} y2={height - MARGIN.bottom} stroke="var(--text-primary)" strokeWidth="1.5" data-testid="drag-line" />
          {series.map((s) => <circle key={`d${s.key}`} cx={x0} cy={sy(s.values[selected])} r="4.5" fill={s.color} stroke="var(--surface-1)" strokeWidth="2" />)}
          <rect x={x0 - 7} y={MARGIN.top - 20} width="14" height="14" rx="3" fill="var(--text-primary)" data-testid="drag-handle" />
          <text className="axis-label" x={MARGIN.left} y={MARGIN.top - 24}>{yLabel}</text>
          <text className="axis-label" x={width - MARGIN.right} y={height - 4} textAnchor="end">{xLabel}</text>
        </svg>
      </div>
    </figure>
  );
}
