import { newRequestId } from "./client";
import type { ResponseStamp } from "./asw";
import { call, post, type Options } from "./p16";

// Chapter 11.5: a network that learned the Black-Scholes call price (server/R/bs_surrogate_model.R). It was trained offline
// (server/scripts/cnn/train_bs_surrogate.R); the server runs it forward, takes its derivative and sets both against rmql's closed form.

export interface BsRequest { spot?: number; strike?: number; ratePct?: number; dividendYieldPct?: number; volatilityPct?: number; time?: number }
export type BsInput = "log_moneyness" | "time" | "volatility" | "rate" | "dividend_yield";
export interface BsResponse {
  inputs: Required<BsRequest>;
  network: { price: number; delta: number; scaled_price: number; log_moneyness: number };
  exact: { price: number; delta: number };
  error: { price: number; price_relative: number; delta: number };
  in_range: Record<BsInput, boolean>;
  warnings: string[];
  training_range: { low: number[]; high: number[] };
  conventions: { network: string; delta: string; exact: string };
  response: ResponseStamp;
}

export interface BsCurve { grid: number[]; exact_price: number[]; network_price: number[]; exact_delta: number[]; network_delta: number[] }
export interface BsErrorRow { set: string; label: string; n: number; price_rmse: number; price_max_abs: number; delta_rmse: number; delta_max_abs: number; price_mean: number }
export interface BsSummary {
  meta: { script: string; rmql_version: string; generated: string; seed: number; r_version: string; platform: string; training_seconds: number };
  settings: { inputs: string[]; range_low: number[]; range_high: number[]; hidden: number; activation: string; epochs: number; optimizer: string; learning_rate: number; n_train: number; n_validation: number; n_test: number };
  gradient_check: Record<string, number>;
  learning_curve: { epoch: number; train_mse: number; validation_mse: number }[];
  errors: BsErrorRow[];
  curves: { log_moneyness: BsCurve; time: BsCurve };
  engine: string;
  response: ResponseStamp;
}

export const fetchBsSurrogate = (request: BsRequest, options: Options = {}) => post<BsResponse>("/api/cnn/bs-surrogate", request, options);
export function fetchBsSummary(options: Options = {}): Promise<BsSummary> {
  return call<BsSummary>("/api/cnn/bs-summary", { method: "GET" }, options.requestId ?? newRequestId(), options);
}
