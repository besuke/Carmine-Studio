import { ApiError, newRequestId } from "./client";
import type { ResponseStamp } from "./asw";

// Chapter 13: lookback options, convertible bonds and MSCB (server/R/lookback_model.R, convertible_model.R). The numbers are
// rmql's; the limits of each request are the server's (docs/part3_chapters_13_15_spec.md, 7) and are in every response.

export type LookbackGreeks = {
  value: number; delta: number; gamma: number; vega: number; rho: number; dividend_rho: number; theta: number;
  strike_sensitivity: number; extremum_sensitivity: number;
};
export type ConvertibleGreeks = {
  value: number; delta: number; gamma: number; vega: number; rho: number; dividend_rho: number; credit_spread_sensitivity: number;
};

export interface LookbackRequest {
  lookbackType?: "floating" | "fixed"; optionType?: "call" | "put"; spot?: number; runningExtremum?: number; strike?: number;
  ratePct?: number; dividendYieldPct?: number; volatilityPct?: number; time?: number; monitoringCount?: number; steps?: number;
}
export interface LookbackResponse {
  inputs: Required<Omit<LookbackRequest, "strike">> & { strike: number | null };
  continuous: LookbackGreeks;
  discrete: LookbackGreeks | null;
  monitoring_times: number[];
  limits: { steps: [number, number] };
  conventions: { continuous: string; discrete: string; engine: string };
  response: ResponseStamp;
}

export interface CallabilityRequest { years: number; kind: "call" | "put"; price: number; priceType?: "clean" | "dirty"; trigger?: number | null }
export interface ConvertibleMarket { spot?: number; ratePct?: number; dividendYieldPct?: number; volatilityPct?: number; creditSpreadPct?: number }
interface BondRequestBase {
  bond?: { remainingYears?: number; couponPct?: number; redemption?: number };
  exercise?: "european" | "american" | "bermudan";
  exerciseYears?: number[];
  callabilities?: CallabilityRequest[];
  market?: ConvertibleMarket;
  steps?: number;
}
export interface ConvertibleRequest extends BondRequestBase {
  conversion?: { kind: "fixed"; ratio?: number } | { kind: "reset"; priceRatio?: number; lowerPrice?: number; upperPrice?: number | null };
}
export interface MscbRequest extends BondRequestBase {
  conversion?: { initialPrice?: number; priceRatio?: number; lowerPrice?: number; upperPrice?: number | null };
  resetYears?: number[]; rule?: "downward_only" | "both"; method?: "scaled" | "grid"; priceNodes?: number; greeks?: boolean;
  scenario?: "down" | "flat" | "up";
}

interface BondResponseBase {
  inputs: Record<string, unknown>;
  values: ConvertibleGreeks;
  conventions: Record<string, string>;
  response: ResponseStamp;
}
export interface ConvertibleResponse extends BondResponseBase {
  conversion_value: { spots: number[]; values: number[] };
  immediate_conversion: boolean;
  limits: { steps: [number, number]; callabilities: number; remaining_years: [number, number] };
}
export interface MscbResponse extends BondResponseBase {
  scenario: { name: string; drift_per_year: number; reset_years: number[]; share_price: number[]; conversion_price: number[]; conversion_ratio: number[] } | null;
  limits: { steps: [number, number]; reset_dates: number; price_nodes: [number, number]; grid_work: number };
}

export interface P16Summary {
  lookback_convergence: { meta: P16Meta; every_step: Record<"call" | "put", { continuous: number; steps: number[]; tree: number[]; error: number[] }>; monthly: Record<string, unknown> };
  convertible_curve: { meta: P16Meta; spots: number[]; conversion_value: number[]; straight_bond: number[]; convertible: { value: number[]; delta: number[] }; convertible_with_call: { value: number[]; delta: number[] } };
  mscb_reset_closed_form: { meta: P16Meta; closed_form_table: { alpha: number; lower_price: number; upper_price: number | null; closed_form: number; steps: number[]; lattice: number[]; relative_error: number[] }[]; immediate_conversion: Record<string, unknown> };
  mscb_carried_grid: { meta: P16Meta; convergence: { price_nodes: number[]; grid: number[]; scaled: number; relative_difference: number[] }; timing: Record<string, number | boolean>[]; greeks: Record<string, unknown> };
  limits: Record<string, unknown>;
  engine: string;
  response: ResponseStamp;
}
export interface P16Meta { script: string; rmql_version: string; generated: string; seed: number | null; r_version: string; platform: string; note: string }

type Options = { baseUrl?: string; signal?: AbortSignal; requestId?: string };

async function call<T extends { response: ResponseStamp }>(path: string, init: RequestInit, requestId: string, options: Options): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${options.baseUrl ?? ""}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("R APIに接続できません。npm run api で起動してください。", null);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  if (body.response?.request_id !== requestId) throw new ApiError("APIの応答が要求と対応していません", res.status);
  return body;
}

function post<T extends { response: ResponseStamp }>(path: string, request: object, options: Options): Promise<T> {
  return call<T>(path, { method: "POST", body: JSON.stringify(request) }, options.requestId ?? newRequestId(), options);
}

export const fetchLookback = (request: LookbackRequest, options: Options = {}) => post<LookbackResponse>("/api/lookback", request, options);
export const fetchConvertible = (request: ConvertibleRequest, options: Options = {}) => post<ConvertibleResponse>("/api/convertible", request, options);
export const fetchMscb = (request: MscbRequest, options: Options = {}) => post<MscbResponse>("/api/mscb", request, options);
export function fetchP16Summary(options: Options = {}): Promise<P16Summary> {
  return call<P16Summary>("/api/lookback-convertible/summary", { method: "GET" }, options.requestId ?? newRequestId(), options);
}
