import { ApiError, newRequestId } from "./client";
import type { ResponseStamp } from "./asw";

// Chapter 15's three-factor PRDC (server/R/prdc_three_factor_model.R): the correlation sensitivities, the cross-gammas and
// the Vanna by automatic differentiation and by finite differences. Money in yen on a notional of 100 million.

export interface ThreeFactorInputs { correlation: { domesticForeign: number; domesticFx: number; foreignFx: number } }

export interface ThreeFactorResponse {
  inputs: ThreeFactorInputs;
  npv: number;
  greeks: { fx_delta: number; fx_vega: number; domestic_dv01: number; foreign_dv01: number };
  effective_volatility: number[];
  correlation: { pair: string; automatic_differentiation: number; finite_difference: number; difference: number }[];
  second_order: { item: string; unit: string; automatic_differentiation: number; finite_difference: number; difference: number }[];
  bumps: { correlation: number; spot: number; volatility: number; rate: number };
  conventions: Record<"model" | "automatic_differentiation" | "second_order" | "bump" | "engine", string>;
  response: ResponseStamp;
}

export async function fetchPrdcThreeFactor(request: { correlation?: Partial<ThreeFactorInputs["correlation"]> },
  options: { baseUrl?: string; signal?: AbortSignal; requestId?: string } = {}): Promise<ThreeFactorResponse> {
  const requestId = options.requestId ?? newRequestId();
  let res: Response;
  try {
    res = await fetch(`${options.baseUrl ?? ""}/api/prdc-three-factor`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify(request),
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("R APIに接続できません。npm run api で起動してください。", null);
  }
  const data = (await res.json().catch(() => null)) as (ThreeFactorResponse & { error?: string }) | null;
  if (!res.ok || !data) throw new ApiError(data?.error ?? `HTTP ${res.status}`, res.status);
  if (data.response?.request_id !== requestId) throw new ApiError("APIの応答が要求と対応していません", res.status);
  return data;
}

/** The graphs of the page (POST /api/prdc-three-factor/scan): every point is one valuation; the tangents come from automatic differentiation. */
export interface ThreeFactorScanResponse {
  inputs: ThreeFactorInputs;
  npv: number;
  correlation: { pair: string; current: number; npv: number; slope: number; points: { rho: number; npv: number; tangent: number }[] }[];
  cross_gamma: Record<"domestic" | "foreign", { delta: number; slope_per_bp: number; points: { shift_bp: number; delta: number; tangent: number }[] }>;
  vanna: {
    delta_by_vol: { delta: number; current: number; slope_per_point: number; points: { vol_pct: number; delta: number; tangent: number }[] };
    vega_by_spot: { vega: number; current: number; slope_per_yen: number; points: { spot: number; vega: number; tangent: number }[] };
  };
  conventions: Record<"correlation" | "cross_gamma" | "vanna" | "engine", string>;
  response: ResponseStamp;
}

export async function fetchPrdcThreeFactorScan(request: { correlation?: Partial<ThreeFactorInputs["correlation"]> },
  options: { baseUrl?: string; signal?: AbortSignal; requestId?: string } = {}): Promise<ThreeFactorScanResponse> {
  const requestId = options.requestId ?? newRequestId();
  let res: Response;
  try {
    res = await fetch(`${options.baseUrl ?? ""}/api/prdc-three-factor/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify(request),
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("R APIに接続できません。npm run api で起動してください。", null);
  }
  const data = (await res.json().catch(() => null)) as (ThreeFactorScanResponse & { error?: string }) | null;
  if (!res.ok || !data) throw new ApiError(data?.error ?? `HTTP ${res.status}`, res.status);
  if (data.response?.request_id !== requestId) throw new ApiError("APIの応答が要求と対応していません", res.status);
  return data;
}
