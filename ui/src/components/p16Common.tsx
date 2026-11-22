import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { fetchP16Summary, type P16Summary } from "../api/p16";

// Shared by the components of chapter 13: a debounced call of the R API that follows the inputs, the saved results, and
// the small pieces every section uses. The page shows what the API returns; no calculation happens here.

export const f = (x: number, n: number) => x.toFixed(n);
export const sign = (x: number, n: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(n)}`;
export const pct = (x: number, n = 3) => `${(100 * x).toFixed(n)}%`;

export const Tag = ({ id }: { id: string }) => <span className="response-tag" data-request-id={id}>API応答 <code>{id}</code></span>;

export interface Call<T> { data: T | null; loading: boolean; error: string | null }

/** Calls `fetcher(request)` 250 ms after the request stops changing; keeps the last answer while the next one is computed. */
export function useCall<R, T>(request: R, fetcher: (r: R, o: { signal: AbortSignal }) => Promise<T>): Call<T> {
  const [state, setState] = useState<Call<T>>({ data: null, loading: true, error: null });
  const key = JSON.stringify(request);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  useEffect(() => {
    const c = new AbortController();
    const timer = window.setTimeout(() => {
      setState((s) => ({ ...s, loading: true }));
      fetchRef.current(JSON.parse(key) as R, { signal: c.signal })
        .then((data) => setState({ data, loading: false, error: null }))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setState((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : String(e) }));
        });
    }, 250);
    return () => { c.abort(); window.clearTimeout(timer); };
  }, [key]);
  return state;
}

/** The saved results (server/data/p16), fetched once per page. */
let summaryPromise: Promise<P16Summary> | null = null;
export function useSummary(): Call<P16Summary> {
  const [state, setState] = useState<Call<P16Summary>>({ data: null, loading: true, error: null });
  useEffect(() => {
    summaryPromise ??= fetchP16Summary();
    let alive = true;
    summaryPromise
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e: unknown) => {
        summaryPromise = null;
        if (alive) setState({ data: null, loading: false, error: e instanceof ApiError ? e.message : String(e) });
      });
    return () => { alive = false; };
  }, []);
  return state;
}

export function Status({ call, label }: { call: Call<unknown>; label: string }) {
  if (call.error && !call.data) return <div className="banner error" role="alert"><strong>R APIの応答を受け取れませんでした。</strong> {call.error}<div className="banner-cmd">起動コマンド：<code>npm run api</code></div></div>;
  return <p className="status" aria-live="polite">{call.loading ? "R APIで計算中…" : label}</p>;
}

/** A number input that ignores what is not a number. */
export function Num({ label, value, onChange, min, max, step = 1, width }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; width?: string }) {
  return (
    <label>{label}{" "}
      <input type="number" aria-label={label} value={value} min={min} max={max} step={step} style={width ? { width } : undefined}
        onChange={(e) => { const v = e.currentTarget.valueAsNumber; if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}

export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label>{label}{" "}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

export function Tile({ label, value, note, emphasis, testId }: { label: string; value: ReactNode; note?: ReactNode; emphasis?: boolean; testId?: string }) {
  return (
    <div className={emphasis ? "tile emphasis" : "tile"}>
      <div className="tile-label">{label}</div>
      <div className="tile-value" data-testid={testId}>{value}</div>
      {note ? <div className="tile-note">{note}</div> : null}
    </div>
  );
}

/** The error of the live call, shown next to the controls: the server's message is in Japanese and says what to change. */
export function CallState({ call, id }: { call: Call<{ response: { request_id: string } }>; id?: string }) {
  return (
    <span className="controls-state">
      {call.loading ? "サーバーで計算中…" : call.error ? <span className="error-text" role="alert">{call.error}</span> : call.data ? <Tag id={id ?? call.data.response.request_id} /> : null}
    </span>
  );
}

export const sciOrFixed = (x: number) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(4));
export const metaLine = (m: { rmql_version: string; generated: string; seed: number | null }) =>
  `事前計算：rmql ${m.rmql_version}、${m.generated.slice(0, 10)}${m.seed ? `、乱数の種 ${m.seed}` : ""}`;
