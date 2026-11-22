// Line icons of the sidebar: 24 x 24, stroked in currentColor (the row's colour; the accent on the active row).
// Drawn for this project as simple shapes, so that each item's meaning reads at a glance next to its name.

import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  // the contents: lines of a list
  contents: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  // the server: two stacked units with lights
  server: <><rect x="3.5" y="4" width="17" height="7" rx="1.5" /><rect x="3.5" y="13" width="17" height="7" rx="1.5" /><path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h6M11 16.5h6" /></>,
  // the introduction: an open book
  book: <><path d="M12 6.5c-2-1.5-5-2-8.5-1.5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5v-13c-3.5-.5-6.5 0-8.5 1.5z" /><path d="M12 6.5v13" /></>,
  // deterministic cash flows: bars on a time line
  cashflow: <><path d="M3.5 20h17" /><path d="M6 20v-4M10 20v-4M14 20v-4M18 20V7" /></>,
  // yield curves: a rising curve on axes
  curve: <><path d="M4 4v16h16" /><path d="M6.5 16c3-6 6-8.5 12-9.5" /></>,
  // JGB futures: a delivery basket of bonds
  futures: <><path d="M4 9h16l-1.5 10h-13z" /><path d="M8 9l2-5M16 9l-2-5" /><path d="M9 13v3M12 13v3M15 13v3" /></>,
  // OIS swaps: two opposite arrows
  swap: <><path d="M4 8h14M14.5 4.5L18 8l-3.5 3.5" /><path d="M20 16H6M9.5 12.5L6 16l3.5 3.5" /></>,
  // the Black model: a bell curve
  bell: <><path d="M3.5 19h17" /><path d="M4.5 19c3 0 4-12 7.5-12s4.5 12 7.5 12" /></>,
  // credit risk and CDS: a shield
  shield: <><path d="M12 3.5l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9v-5z" /><path d="M9 12l2 2 4-4" /></>,
  // calibration: sliders
  sliders: <><path d="M5 4v16M12 4v16M19 4v16" /><circle cx="5" cy="14" r="2" /><circle cx="12" cy="8" r="2" /><circle cx="19" cy="15" r="2" /></>,
  // interest-rate models: random paths
  paths: <><path d="M3.5 12l3-2 3 4 3-6 3 3 5-4" /><path d="M3.5 12l3 1.5 3-1 3 4 3-1.5 5 3" /></>,
  // early redemption: an arrow turning back
  callback: <><path d="M9 7H5V3" /><path d="M5.5 7A8 8 0 1 1 4 13" /><path d="M12 8v4l2.5 2" /></>,
  // parallel computing: lanes side by side
  parallel: <><path d="M5 4v16M10 4v16M15 4v16M20 4v16" /><path d="M3.5 9h3M8.5 14h3M13.5 7h3M18.5 16h3" /></>,
  // distributed computing: nodes of a network
  network: <><rect x="9.5" y="3" width="5" height="5" rx="1" /><rect x="3" y="16" width="5" height="5" rx="1" /><rect x="16" y="16" width="5" height="5" rx="1" /><path d="M12 8v4M5.5 16v-4h13v4" /></>,
  // CNN: a kernel sliding over a row of cells
  convolution: <><path d="M3.5 17.5h17M3.5 13.5h17M3.5 9.5h17" /><rect x="7.5" y="6.5" width="7" height="14" rx="1.2" /><path d="M5 4.5l2.5 2M16.5 4.5l-2 2" /></>,
  // CNN as a surrogate model: a small network replacing a box
  surrogate: <><circle cx="5" cy="7" r="1.8" /><circle cx="5" cy="17" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /><path d="M6.6 7.8L10.4 11.2M6.6 16.2L10.4 12.8M13.8 12h3.4" /></>,
  // lookback: a price path above its running minimum
  lookback: <><path d="M3.5 6.5l4 5 3-2.5 3.5 6 3-3.5 3 2.5" /><path d="M3.5 19.5h17" /><circle cx="14" cy="15.5" r="1.3" /></>,
  // MBS: a balance paid down month by month
  mbs: <><path d="M5.5 20V7.5M10 20v-9M14.5 20v-6M19 20v-3" /><path d="M3.5 20.5h17" /></>,
  // automatic differentiation: a partial derivative
  derivative: <><path d="M15.5 6.5C14 4 9.5 4 8.5 7c-.6 1.8.8 3 3 3 3.5 0 5 2.5 4 5.5-1 3.2-5.5 4.5-8 2" /><circle cx="11" cy="15" r="2.5" /></>,
  // PRDC: a currency coin with an arrow
  fx: <><circle cx="9" cy="12" r="5.5" /><path d="M7 9.5l2 3 2-3M9 12.5V15M7.5 13h3" /><path d="M16 8h4.5M18.5 6l2 2-2 2M20.5 16H16M18 14l-2 2 2 2" /></>,
  // collapse and expand the sidebar
  collapse: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M9.5 4v16M15.5 10l-2 2 2 2" /></>,
  expand: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M9.5 4v16M13.5 10l2 2-2 2" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
