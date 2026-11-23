import type { ReactNode } from "react";

// 「この章の使い方」: a short, numbered guide placed next to a chapter's first control panel.
// Each step names the real items on the screen; `to` is the leading number of a section heading
// (for example "II-1.4.1"), so the reader can jump to the section that shows the result.
// The chapter route uses the URL hash, so the jump scrolls to the heading instead of changing the hash.

export interface UsageStep {
  /** The step text; item names on the screen go in <b>…</b>. */
  text: ReactNode;
  /** Leading number of the heading to scroll to, such as "II-1.5.2", or the id of an element. */
  to?: string;
}

function headingStartingWith(prefix: string): HTMLElement | null {
  const hs = document.querySelectorAll<HTMLElement>(".prose h2, .prose h3, .prose h4");
  for (const h of Array.from(hs)) if ((h.textContent ?? "").trim().startsWith(prefix)) return h;
  return null;
}

function jump(prefix: string) {
  const h = document.getElementById(prefix) ?? headingStartingWith(prefix);
  if (!h) return;
  h.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
  h.focus({ preventScroll: true });
}

export function UsageGuide({ lead, steps }: { lead: ReactNode; steps: UsageStep[] }) {
  return (
    <aside className="usage-guide" aria-label="この章の使い方" data-testid="usage-guide">
      <h2 className="usage-title">この章の使い方</h2>
      <p>{lead}</p>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>
            {s.text}
            {s.to && (
              <>
                {" "}
                <button type="button" className="usage-jump" data-testid={`usage-jump-${s.to}`} onClick={() => jump(s.to!)}>
                  {s.to} へ
                </button>
              </>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
