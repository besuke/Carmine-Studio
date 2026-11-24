import { useLayoutEffect, useRef, useState } from "react";

// A waterfall: each step starts where the one before ended, and the last bar is the total from zero. Values come from the API.

export interface WaterfallStep {
  label: string;
  value: number; // signed; for a total, its value
  kind: "delta" | "total";
  color: string; // CSS variable reference
}

interface Props {
  title: string;
  steps: WaterfallStep[];
  yLabel: string;
  /** The text of a value (with its sign and unit). */
  formatValue: (v: number) => string;
  formatTick?: (v: number) => string;
  footer?: React.ReactNode;
}

const MARGIN = { top: 26, right: 16, bottom: 40, left: 56 };

function niceTicks(min: number, max: number, count = 5): number[] {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

export function WaterfallChart({ title, steps, yLabel, formatValue, formatTick, footer }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.max(280, Math.floor(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  let running = 0;
  const bars = steps.map((s) => {
    const start = s.kind === "total" ? 0 : running;
    const end = s.kind === "total" ? s.value : running + s.value;
    if (s.kind === "delta") running = end;
    return { ...s, start, end };
  });
  const height = 280;
  const lo = Math.min(0, ...bars.flatMap((b) => [b.start, b.end]));
  const hi = Math.max(0, ...bars.flatMap((b) => [b.start, b.end]));
  const pad = (hi - lo) * 0.12 || 1;
  const yMin = lo - pad, yMax = hi + pad;
  const innerW = width - MARGIN.left - MARGIN.right, innerH = height - MARGIN.top - MARGIN.bottom;
  const slot = innerW / bars.length, barW = Math.min(90, slot * 0.6);
  const cx = (i: number) => MARGIN.left + slot * (i + 0.5);
  const sy = (y: number) => MARGIN.top + (1 - (y - yMin) / (yMax - yMin)) * innerH;
  return (
    <figure className="chart" ref={ref} data-testid="waterfall">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="chart-body">
        <svg width={width} height={height} role="img" aria-label={`${title}（縦軸：${yLabel}）`}>
          {niceTicks(yMin, yMax).map((t) => (
            <g key={t}>
              <line className="grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={sy(t)} y2={sy(t)} />
              <text className="tick" x={MARGIN.left - 8} y={sy(t)} dy="0.32em" textAnchor="end">{(formatTick ?? String)(t)}</text>
            </g>
          ))}
          <line className="axis" x1={MARGIN.left} x2={width - MARGIN.right} y1={sy(0)} y2={sy(0)} />
          {bars.slice(0, -1).map((b, i) => (
            <line key={`c${i}`} className="axis" strokeDasharray="3 3" x1={cx(i) + barW / 2} x2={cx(i + 1) - barW / 2} y1={sy(b.end)} y2={sy(b.end)} />
          ))}
          {bars.map((b, i) => {
            const top = Math.min(sy(b.start), sy(b.end));
            const h = Math.max(2, Math.abs(sy(b.start) - sy(b.end)));
            return (
              <g key={b.label}>
                <rect className="bar" x={cx(i) - barW / 2} y={top} width={barW} height={h} rx="2" fill={b.color} data-testid={`wf-bar-${i}`}>
                  <title>{`${b.label}：${formatValue(b.value)}`}</title>
                </rect>
                <text className="tick" x={cx(i)} y={top - 6} textAnchor="middle" fontWeight="600" data-testid={`wf-value-${i}`}>{formatValue(b.value)}</text>
                <text className="tick" x={cx(i)} y={height - MARGIN.bottom + 18} textAnchor="middle">{b.label}</text>
              </g>
            );
          })}
          <text className="axis-label" x={MARGIN.left} y={MARGIN.top - 12}>{yLabel}</text>
        </svg>
      </div>
      {footer && <div className="chart-footer">{footer}</div>}
    </figure>
  );
}
