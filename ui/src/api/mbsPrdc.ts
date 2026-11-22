import { newRequestId } from "./client";
import type { ResponseStamp } from "./asw";
import { call, post, type Options, type P16Meta } from "./p16";

// Chapter 14: the MBS balance and OAS, the PRDC target redemption and knock-out (server/R/mbs_prdc_model.R). The numbers are
// rmql's; the limits of each request are the server's and are in every response.

export interface MbsRequest {
  pool?: { balance?: number; mortgageRatePct?: number; passThroughRatePct?: number; months?: number; psaPct?: number; incentive?: number; refiCostPct?: number };
  refinanceStartPct?: number; slopePct?: number;
  mc?: { paths?: number; seed?: number; meanReversion?: number; volatilityPct?: number; flatRatePct?: number; spreadPct?: number; assumedPrice?: number };
}
export interface MbsScenario {
  name: "down" | "flat" | "up"; slope_pct_per_year: number; refinance_rate: number[]; balance: number[]; end_balance: number[]; cpr: number[];
  prepaid: number[]; cashflow: number[]; price: number; weighted_average_life: number;
}
export interface MbsResponse {
  inputs: Record<string, unknown>;
  months: number[];
  scenarios: Record<"down" | "flat" | "up", MbsScenario>;
  monte_carlo: {
    price: number; standard_error: number; weighted_average_life: number; prices: number[]; oas: number; oas_bp: number; assumed_price: number;
    sample_paths: { path: number; price: number; short_rate: number[]; balance: number[]; cpr: number[] }[];
  };
  limits: { months: [number, number]; paths: [number, number] };
  conventions: { prepayment: string; discount: string; scenario: string; engine: string };
  response: ResponseStamp;
}

export interface TarnRequest {
  note?: { years?: number; spot?: number; fxVolPct?: number; domesticPct?: number; foreignPct?: number; fxBase?: number; leveragePct?: number; subtractionPct?: number; floorPct?: number; capPct?: number; notional?: number };
  tarn?: { targetPct?: number | null; targetCoupon?: "capped" | "full"; makeWhole?: boolean; knockOutLevel?: number | null };
  mc?: { paths?: number; stepsPerYear?: number; seed?: number };
}
export interface TarnResponse {
  inputs: Record<string, unknown>;
  summary: { value: number; standard_error: number; analytic: number; plain_value: number; expected_life: number };
  endings: { times: number[]; target_probability: number[]; knock_out_probability: number[]; alive: number[] } | null;
  coupon_curve: { fx: number[]; coupon: number[] };
  limits: { years: [number, number]; paths: [number, number]; steps_per_year: [number, number]; work: number };
  conventions: { state: string; target: string; model: string; engine: string };
  response: ResponseStamp;
}

export interface MbsPrdcSummary {
  mbs_oas_convergence: {
    meta: P16Meta; static_oas_bp: number;
    rows: { paths: number; seeds: number; oas_bp: number[]; mean_oas_bp: number; sd_oas_bp: number | null; seconds: number }[];
  };
  prdc_tarn_distribution: {
    meta: P16Meta;
    endings: { times: number[]; target_probability: number[]; knock_out_probability: number[]; alive_at_maturity: number };
    summary_200000: { value: number; standard_error: number; analytic: number; plain_value: number; expected_life: number };
    convergence: { paths: number; value: number; standard_error: number; plain_value: number; expected_life: number }[];
    by_target: { target_pct: number; value: number; standard_error: number; plain_value: number; expected_life: number }[];
    no_target: { value: number; standard_error: number; analytic: number };
  };
  limits: Record<string, unknown>;
  engine: string;
  response: ResponseStamp;
}

export const fetchMbsState = (request: MbsRequest, options: Options = {}) => post<MbsResponse>("/api/mbs/state", request, options);
export const fetchTarn = (request: TarnRequest, options: Options = {}) => post<TarnResponse>("/api/prdc/tarn", request, options);
export function fetchMbsPrdcSummary(options: Options = {}): Promise<MbsPrdcSummary> {
  return call<MbsPrdcSummary>("/api/mbs-prdc/summary", { method: "GET" }, options.requestId ?? newRequestId(), options);
}
