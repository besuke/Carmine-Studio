# Reconcile the interest-rate models chapter (Coral Book II-7): the manuscript's code (R, with its seeds) against
# the page's own model (server/R/rate_models_model.R, rmql where it takes the same normals), and that model
# against the manuscript's own results (rmql comparison/baseline/lagrange_values.csv).
#
#   npm run reconcile:rate-models
#
# Writes server/tests/golden/rate_models_golden.json (the manuscript's code's values) and server/tests/reconciliation/rate_models/results/.

suppressPackageStartupMessages({
  library(rmql)
  library(dplyr)
  library(purrr)
  library(tibble)
  library(jsonlite)
})

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/rate_models/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
source(file.path(lab, "server/R/rate_models_model.R"))
api <- rate_models_compute(list())

# ---- the manuscript's code (II-7.2, II-7.4, II-7.5), verbatim in substance ------------------------------------------
compute_hw_shift_LRL <- function(time, flat_rate, mean_reversion, volatility) {
  flat_rate + volatility^2 / (2 * mean_reversion^2) * (1 - exp(-mean_reversion * time))^2
}
simulate_hw_paths_LRL <- function(flat_rate, mean_reversion, volatility, horizon = 5, steps_per_year = 24L, number_of_paths = 8000L, seed = 617L) {
  number_of_steps <- as.integer(horizon * steps_per_year)
  step_size <- horizon / number_of_steps
  times <- seq(0, horizon, length.out = number_of_steps + 1L)
  set.seed(seed)
  shocks <- matrix(stats::rnorm(number_of_paths * number_of_steps), nrow = number_of_paths)
  decay <- exp(-mean_reversion * step_size)
  shock_scale <- volatility * sqrt(-expm1(-2 * mean_reversion * step_size) / (2 * mean_reversion))
  states <- do.call(cbind, purrr::accumulate(seq_len(number_of_steps), .init = rep(0, number_of_paths),
                                             .f = function(previous, index) decay * previous + shock_scale * shocks[, index]))
  rates <- sweep(states, 2, compute_hw_shift_LRL(times, flat_rate, mean_reversion, volatility), FUN = "+")
  list(times = times, rates = rates, step_size = step_size)
}
hw_example <- simulate_hw_paths_LRL(0.02, 0.12, 0.01)
discount_matrix <- exp(-t(apply(hw_example$rates[, -ncol(hw_example$rates), drop = FALSE] * hw_example$step_size, 1, cumsum)))
ms_discount <- map_dbl(c(1, 2, 5), \(m) mean(discount_matrix[, as.integer(round(m / hw_example$step_size))]))

compute_black_caplet_LRL <- function(forward, strike, volatility, expiry, accrual, discount_factor, notional = 1) {
  scale <- notional * accrual * discount_factor
  total_volatility <- volatility * sqrt(expiry)
  d1 <- (log(forward / strike) + total_volatility^2 / 2) / total_volatility
  d2 <- d1 - total_volatility
  scale * (forward * stats::pnorm(d1) - strike * stats::pnorm(d2))
}
discount_factor <- exp(-0.02 * (2 + 0.5))
set.seed(618L)
forward_at_expiry <- 0.025 * exp(-0.24^2 * 2 / 2 + 0.24 * sqrt(2) * stats::rnorm(50000L))
discounted_payoff <- 0.5 * discount_factor * pmax(forward_at_expiry - 0.0275, 0)
ms_caplet <- list(black = compute_black_caplet_LRL(0.025, 0.0275, 0.24, 2, 0.5, discount_factor),
                  simulated = mean(discounted_payoff), se = stats::sd(discounted_payoff) / sqrt(50000L))

target_correlation <- matrix(c(1, 0.8, 0.5, 0.8, 1, 0.7, 0.5, 0.7, 1), nrow = 3, byrow = TRUE)
set.seed(619L)
independent_shocks <- matrix(stats::rnorm(90000), ncol = 3)
ms_correlation <- stats::cor(independent_shocks %*% chol(target_correlation))

obs <- seq_len(90)
rate <- 0.01 + 0.004 * sin(2 * pi * obs / 90)
ms_compounded <- (prod(1 + rate / 365) - 1) / (90 / 365)
ms_to_date <- (cumprod(1 + rate / 365) - 1) / cumsum(rep(1 / 365, 90))

# ---- comparisons -----------------------------------------------------------------------------------------------
base <- utils::read.csv("C:/AnalyticFin/Projects/RiemannQL/comparison/baseline/lagrange_values.csv", stringsAsFactors = FALSE)
bv <- function(key) base$value[match(key, base$key)]
cmp <- function(item, a, ref, tol, note = "") {
  d <- max(abs(as.numeric(a) - as.numeric(ref)))
  tibble(item = item, n = length(a), max_abs_diff = d, tolerance = tol, pass = is.finite(d) && d <= tol, note = note)
}
info <- function(item, a, ref, note) tibble(item = item, n = length(a), max_abs_diff = max(abs(as.numeric(a) - as.numeric(ref))), tolerance = NA_real_, pass = NA, note = note)
dc <- api$hw$discount_check
rmql_rows <- dc[grepl("rmql", dc$model), ]
corr_keys <- with(api$shocks$table, sprintf("lmm.correlation.%s.%s", forward_1, forward_2))
rows <- bind_rows(
  cmp("HW：表示する短期金利の経路（8本 × 121点）", unlist(api$hw$sample_paths), as.vector(t(hw_example$rates[1:8, ])), 0),
  cmp("HW：平均の経路", api$hw$mean_path, colMeans(hw_example$rates), 1e-15),
  cmp("HW：経路別割引の平均（1・2・5年）", dc$simulation[!grepl("rmql", dc$model)], ms_discount, 1e-15),
  info("HW：rmql の月次の経路の割引 − 初期曲線（1・2・5年）", rmql_rows$simulation, rmql_rows$initial_curve,
       sprintf("判定しない：乱数が別（パッケージの乱数、antithetic）。差は標準誤差の最大 %.2f 倍",
               max(abs(rmql_rows$difference) / rmql_rows$mc_standard_error))),
  cmp("キャップレット：Black の公式（RFM − 原稿の R 関数）", api$caplet$black_price, ms_caplet$black, 1e-17),
  cmp("キャップレット：周辺分布のモンテカルロ（同じ R の乱数）", api$caplet$simulated_price, ms_caplet$simulated, 1e-17),
  cmp("キャップレット：標準誤差", api$caplet$mc_standard_error, ms_caplet$se, 1e-17),
  cmp("相関ショックの標本相関（9要素）", api$shocks$table$simulated,
      ms_correlation[cbind(match(api$shocks$table$forward_1, c("A", "B", "C")), match(api$shocks$table$forward_2, c("A", "B", "C")))], 1e-14),
  cmp("後決め金利：90日の複利", api$fixings$compounded_rate, ms_compounded, 1e-16, "期間の日数割合を 1/365 の和で割るか 90/365 で割るかの最下位ビットの差"),
  cmp("後決め金利：当日までの年率", api$fixings$daily$realized_rate_to_date, ms_to_date, 0),
  cmp("原稿：キャップレット Black（bp）", 1e4 * api$caplet$black_price, bv("lmm.caplet.black_bp"), 1e-12),
  cmp("原稿：キャップレット モンテカルロ（bp）", 1e4 * api$caplet$simulated_price, bv("lmm.caplet.simulated_bp"), 1e-12),
  cmp("原稿：キャップレット 標準誤差（bp）", 1e4 * api$caplet$mc_standard_error, bv("lmm.caplet.standard_error_bp"), 1e-12),
  cmp("原稿：相関ショックの標本相関", api$shocks$table$simulated, bv(corr_keys), 1e-12)
)
options(width = 220)
print(rows |> select(item, n, max_abs_diff, tolerance, pass), n = Inf)
rows |> filter(nzchar(note)) |> pwalk(\(item, note, ...) cat(item, "：", note, "\n"))
utils::write.csv(rows, file.path(out_dir, "rate_models_diffs.csv"), row.names = FALSE)

golden <- list(
  engine = "the manuscript's R code (R's set.seed and rnorm)",
  hw_sample_paths = lapply(1:8, \(i) hw_example$rates[i, ]), hw_discount = ms_discount,
  caplet = ms_caplet, correlation = ms_correlation, compounded = ms_compounded
)
write(toJSON(golden, auto_unbox = TRUE, digits = I(17), pretty = TRUE, na = "null"), file.path(lab, "server/tests/golden/rate_models_golden.json"))
writeLines(c(paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")), R.version.string, paste("rmql", as.character(packageVersion("rmql")))),
           file.path(out_dir, "session_info.txt"))
stopifnot(all(rows$pass, na.rm = TRUE))
