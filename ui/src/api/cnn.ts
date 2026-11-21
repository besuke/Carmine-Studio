import { ApiError, newRequestId } from "./client";
import type { ResponseStamp } from "./asw";

// The 1D-CNN experiment of chapter 11.4 (server/R/cnn_model.R). The network was trained offline, walk-forward, by
// server/scripts/cnn/train_jgb_1d_cnn.R; the server returns the saved results and values a bond with rmql.

export type CnnModel = "random_walk" | "ridge" | "cnn";
export type CnnPeriod = "all" | "first_half" | "second_half" | "since_2022";

export interface CnnMetricRow { model: CnnModel; tenor: string; rmse: number; mae: number; months: number }

export interface CnnSummaryResponse {
  settings: {
    tenors: number[]; lookback: number; min_train: number; retrain_every: number; filters: number; kernel: number; l2: number;
    learning_rate: number; max_epochs: number; patience: number; validation_share: number; seeds: number; base_seed: number;
  };
  data: { file: string; months: number; first: string; last: string };
  generated: string;
  gradient_check: Record<"kernel" | "conv_bias" | "dense_weight" | "dense_bias" | "input", number>;
  metrics: Record<CnnPeriod, CnnMetricRow[]>;
  share_better_than_random_walk: { ridge: number; cnn: number };
  months: { origin: string[]; target: string[] };
  rolling_rmse_window: number;
  /** pooled over the four tenors, bp; null for the first months, before a full window */
  rolling_rmse: Record<CnnModel, (number | null)[]>;
  /** filters x (channels x kernel width), in standardized units; the column of channel c and lag k is c * kernel + k */
  kernels: { origin_month: string[]; train_samples: number[]; last: number[][]; first: number[][] };
  conventions: { note: string; engine: string };
  response: ResponseStamp;
}

export interface CnnBondInputs { remainingYears: number; couponPct: number; faceAmount: number }
export type CnnScenario = "actual" | "cnn" | "ridge" | "random_walk";

export interface CnnForecastResponse {
  inputs: { month: string; bond: CnnBondInputs };
  dates: { origin: string; next_month: string };
  nodes: {
    tenor: number[];
    current: number[]; // yields (%) at the chosen month-end
    scenario: Record<CnnScenario, number[]>; // yields (%) at the next month-end
    change_bp: Record<CnnScenario, number[]>;
  };
  curves: { years: number[]; current: number[]; scenario: Record<CnnScenario, number[]> }; // zero rates (%), every half year
  current_value: { npv: number; clean_price: number };
  valuation: { scenario: CnnScenario; label: string; npv: number; clean_price: number; pnl: number; pnl_error: number }[];
  conventions: { curve: string; bond: string; pnl: string; engine: string };
  response: ResponseStamp;
}

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

export function fetchCnnSummary(options: Options = {}): Promise<CnnSummaryResponse> {
  const requestId = options.requestId ?? newRequestId();
  return call<CnnSummaryResponse>("/api/cnn/jgb-summary", { method: "GET" }, requestId, options);
}

export function fetchCnnForecast(request: { month: string; bond?: Partial<CnnBondInputs> }, options: Options = {}): Promise<CnnForecastResponse> {
  const requestId = options.requestId ?? newRequestId();
  return call<CnnForecastResponse>("/api/cnn/jgb-forecast", { method: "POST", body: JSON.stringify(request) }, requestId, options);
}
