// Bubbles in a row: the area is the absolute value, the color the sign, the label the amount. The scale is given (the largest value
// over every point that can be selected), so that the bubbles keep their size while a line is dragged.

export interface Bubble {
  label: string; // what it is
  value: number; // signed
}

interface Props {
  title: string;
  items: Bubble[];
  /** The value whose bubble has the largest radius. */
  scale: number;
  formatValue: (v: number) => string;
  plusColor?: string;
  minusColor?: string;
}

const R_MAX = 46;

export function BubbleChart({ title, items, scale, formatValue, plusColor = "var(--series-3)", minusColor = "var(--critical)" }: Props) {
  const width = 100 * items.length, height = 2 * R_MAX + 64;
  return (
    <figure className="chart" data-testid="bubbles">
      <figcaption className="chart-title">{title}</figcaption>
      <ul className="legend" aria-label="凡例">
        <li><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="6" fill={plusColor} /></svg>プラス</li>
        <li><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="6" fill={minusColor} /></svg>マイナス</li>
      </ul>
      <div className="chart-body">
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={`${title}：${items.map((b) => `${b.label} ${formatValue(b.value)}`).join("、")}`}>
          {items.map((b, i) => {
            const r = R_MAX * Math.sqrt(Math.min(Math.abs(b.value) / (scale || 1), 1)); // area is proportional to the absolute value
            const cx = 50 + 100 * i, cy = R_MAX + 16;
            return (
              <g key={b.label}>
                <circle cx={cx} cy={cy} r={Math.max(r, 1.5)} fill={b.value >= 0 ? plusColor : minusColor} fillOpacity="0.85" data-testid={`bubble-${i}`} data-r={r.toFixed(2)}>
                  <title>{`${b.label}：${formatValue(b.value)}`}</title>
                </circle>
                <text className="tick" x={cx} y={cy + R_MAX + 18} textAnchor="middle" fontWeight="600" data-testid={`bubble-value-${i}`}>{formatValue(b.value)}</text>
                <text className="tick" x={cx} y={cy + R_MAX + 34} textAnchor="middle">{b.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
