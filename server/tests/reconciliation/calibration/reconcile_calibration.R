# Reconcile the calibration chapter (Coral Book II-6): GaussQuant / QuantLib running the manuscript's code
# against the page's own model (server/R/calibration_model.R, rmql), and that model against the manuscript's
# own results (rmql comparison/baseline/lagrange_values.csv). The inputs are the manuscript's illustrative values.
#
#   npm run reconcile:calibration
#
# Writes server/tests/golden/calibration_golden.json (GaussQuant's values) and server/tests/reconciliation/calibration/results/.

suppressPackageStartupMessages({
  library(GaussQuant)
  library(rmql)
  library(dplyr)
  library(purrr)
  library(tibble)
  library(jsonlite)
})

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/calibration/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
source(file.path(lab, "server/R/calibration_model.R"))
api <- calibration_compute(list())

# ---- the manuscript's code (II-6.2–6.5), with GaussQuant for the SABR volatility ---------------------------------
normal_option_price_LRL <- function(forward, strike, volatility, maturity, discount_factor = 1, option_sign = 1) {
  intrinsic <- discount_factor * max(option_sign * (forward - strike), 0)
  standard_deviation <- volatility * sqrt(maturity)
  if (standard_deviation == 0) return(intrinsic)
  d <- (forward - strike) / standard_deviation
  discount_factor * (option_sign * (forward - strike) * stats::pnorm(option_sign * d) + standard_deviation * stats::dnorm(d))
}
manuscript_normal <- map_dbl(api$normal$by_strike$strike, \(k) normal_option_price_LRL(0.0056, k, 40 / 10000, 2))

tbl_sabr_market <- tibble(strike_pct = CAL_SABR$strike_pct, black_vol_pct = CAL_SABR$black_vol_pct) |>
  mutate(strike = strike_pct / 100, black_volatility = black_vol_pct / 100)
gq_sabr_vol <- function(strike, parameters) {
  GaussQuant::safe_sabr_vol_GQL(strike = strike, forward = 0.0056, maturity = 2, alpha = parameters[["alpha"]], beta = 0.5,
                                volvol = parameters[["volvol"]], rho = parameters[["rho"]])
}
sabr_objective <- function(parameters) {
  names(parameters) <- c("alpha", "volvol", "rho")
  model_vol <- tryCatch(map_dbl(tbl_sabr_market$strike, \(k) gq_sabr_vol(k, parameters)), error = \(e) rep(NA_real_, nrow(tbl_sabr_market)))
  if (any(!is.finite(model_vol))) return(1e6)
  mean((model_vol - tbl_sabr_market$black_volatility)^2)
}
gq_sabr_fit <- stats::optim(c(alpha = 0.1, volvol = 0.1, rho = 0.1), sabr_objective, method = "L-BFGS-B",
                            lower = c(1e-4, 0, -0.999), upper = c(1, 5, 0.999), control = list(maxit = 1000))
gq_sabr_par <- stats::setNames(gq_sabr_fit$par, c("alpha", "volvol", "rho"))
gq_sabr_fitted <- map_dbl(tbl_sabr_market$strike, \(k) gq_sabr_vol(k, gq_sabr_par))

compute_hw_bond_option_price_LRL <- function(option_maturity, bond_maturity, strike, mean_reversion, short_rate_volatility, initial_zero_rate) {
  discount_option <- exp(-initial_zero_rate * option_maturity)
  discount_bond <- exp(-initial_zero_rate * bond_maturity)
  bond_std_dev <- short_rate_volatility / mean_reversion * (-expm1(-mean_reversion * (bond_maturity - option_maturity))) *
    sqrt(-expm1(-2 * mean_reversion * option_maturity) / (2 * mean_reversion))
  h <- log(discount_bond / (strike * discount_option)) / bond_std_dev + bond_std_dev / 2
  discount_bond * stats::pnorm(h) - strike * discount_option * stats::pnorm(h - bond_std_dev)
}
hw_market <- CAL_HW |>
  mutate(strike = exp(-0.03 * (bond_maturity - option_maturity)) * strike_multiplier,
         market_price = pmap_dbl(list(option_maturity, bond_maturity, strike), \(t, s, k) compute_hw_bond_option_price_LRL(t, s, k, 0.08, 0.012, 0.03)))
hw_objective <- function(parameters) {
  fit <- filter(hw_market, sample == "fit")
  fitted <- pmap_dbl(list(fit$option_maturity, fit$bond_maturity, fit$strike), \(t, s, k) compute_hw_bond_option_price_LRL(t, s, k, parameters[[1]], parameters[[2]], 0.03))
  sum((10000 * (fitted - fit$market_price))^2)
}
hw_fit <- stats::optim(c(a = 0.05, sigma = 0.01), hw_objective, method = "L-BFGS-B", lower = c(0.001, 0.0001), upper = c(1, 0.1),
                       control = list(maxit = 1000, factr = 1e3))
hw_model <- pmap_dbl(list(hw_market$option_maturity, hw_market$bond_maturity, hw_market$strike),
                     \(t, s, k) compute_hw_bond_option_price_LRL(t, s, k, hw_fit$par[["a"]], hw_fit$par[["sigma"]], 0.03))

compute_bgm_swap_vol_proxy_LRL <- function(correlation_decay, tenor, caplet_volatility, weights) {
  correlation <- exp(-correlation_decay * abs(outer(tenor, tenor, "-")))
  weighted_volatility <- weights * caplet_volatility
  sqrt(as.numeric(t(weighted_volatility) %*% correlation %*% weighted_volatility))
}
bgm_target <- compute_bgm_swap_vol_proxy_LRL(0.45, 1:4, c(0.24, 0.22, 0.21, 0.20), c(0.28, 0.26, 0.24, 0.22))
bgm_fit <- stats::optimize(\(d) (compute_bgm_swap_vol_proxy_LRL(d, 1:4, c(0.24, 0.22, 0.21, 0.20), c(0.28, 0.26, 0.24, 0.22)) - bgm_target)^2, c(0.01, 2))

# ---- comparisons -----------------------------------------------------------------------------------------------
base <- utils::read.csv("C:/AnalyticFin/Projects/RiemannQL/comparison/baseline/lagrange_values.csv", stringsAsFactors = FALSE)
bv <- function(key) base$value[match(key, base$key)]
cmp <- function(item, a, ref, tol, note = "") {
  d <- max(abs(as.numeric(a) - as.numeric(ref)))
  tibble(item = item, n = length(a), max_abs_diff = d, tolerance = tol, pass = is.finite(d) && d <= tol, note = note)
}
info <- function(item, a, ref, note) {
  tibble(item = item, n = length(a), max_abs_diff = max(abs(as.numeric(a) - as.numeric(ref))), tolerance = NA_real_, pass = NA, note = note)
}
s <- api$sabr; h <- api$hw
sabr_keys <- paste0("sabr.volatility_pct.", format(CAL_SABR$strike_pct, trim = TRUE, drop0trailing = TRUE))
hw_keys <- sprintf("%g.%g", CAL_HW$option_maturity, CAL_HW$bond_maturity)
ms_par <- c(alpha = s$fits$alpha[1], nu = s$fits$nu[1], rho = s$fits$rho[1])
at_legacy_sabr <- rmql::compute_sabr_volatility("lognormal", CAL_SABR$strike_pct / 100, 0.0056, 2, bv("sabr.alpha"), 0.5, bv("sabr.nu"), bv("sabr.rho"))
at_legacy_hw <- rmql::compute_hull_white_bond_option_value("call", h$options$strike, h$options$option_maturity, h$options$bond_maturity,
  bv("hw.calibration.a_pct") / 100, bv("hw.calibration.sigma_pct") / 100,
  rmql::create_flat_curve(CAL_CURVE_DATE, 0.03, "actual_365_fixed", "continuous"))
OPTIM_NOTE <- "同じ optim・同じ初期値と範囲。目的関数の値の最下位ビットの差で、止まる位置がわずかに動く"
rows <- bind_rows(
  cmp("Normal 型の価格（原稿の R 関数 − RFM、71 行使）", api$normal$by_strike$normal, manuscript_normal, 1e-15),
  cmp("SABR：GaussQuant の optim の解 − 原稿", gq_sabr_par, c(bv("sabr.alpha"), bv("sabr.nu"), bv("sabr.rho")), 0),
  cmp("SABR：原稿の解での RFM のボラ − 原稿（%、7点）", 100 * at_legacy_sabr, bv(sabr_keys), 1e-12),
  cmp("SABR：原稿の手順を RFM で − GaussQuant（α・ν・ρ）", ms_par, gq_sabr_par, 1e-9, OPTIM_NOTE),
  cmp("SABR：原稿の手順を RFM で − GaussQuant（あてはめたボラ）", s$quotes$manuscript_fit, gq_sabr_fitted, 1e-10, OPTIM_NOTE),
  cmp("SABR：原稿の手順を RFM で − GaussQuant（RMSE）", s$fits$rmse[1], sqrt(gq_sabr_fit$value), 1e-12),
  info("SABR：calibrate_sabr − 原稿の手順（α・ν・ρ）", c(s$fits$alpha[2], s$fits$nu[2], s$fits$rho[2]), ms_par,
       sprintf("判定しない：最適化の方法が違う。RMSE は RFM %.10f、原稿の手順 %.10f", s$fits$rmse[2], s$fits$rmse[1])),
  cmp("HW：市場価格（RFM − 原稿の R 関数）", h$options$market_price, hw_market$market_price, 1e-15),
  cmp("原稿：HW 市場価格（bp）", 1e4 * h$options$market_price, bv(paste0("hw.option_bp.", hw_keys)), 1e-10),
  cmp("原稿：HW 原稿の解でのモデル価格（bp）", 1e4 * at_legacy_hw, bv(paste0("hw.calibration.model_bp.", hw_keys)), 1e-10),
  cmp("原稿：HW 原稿の解での価格誤差（bp）", 1e4 * (at_legacy_hw - h$options$market_price), bv(paste0("hw.calibration.error_bp.", hw_keys)), 1e-10),
  cmp("HW：原稿の手順を RFM で − 原稿の R 関数（a・σ）", c(h$fits$a[1], h$fits$sigma[1]), hw_fit$par, 1e-9, OPTIM_NOTE),
  cmp("原稿：HW の a・σ（%）", 100 * c(h$fits$a[1], h$fits$sigma[1]), c(bv("hw.calibration.a_pct"), bv("hw.calibration.sigma_pct")), 1e-7, OPTIM_NOTE),
  cmp("原稿：HW 目的関数", h$fits$objective[1], bv("hw.calibration.objective"), 1e-9, OPTIM_NOTE),
  cmp("HW：原稿の手順の再評価（RFM − 原稿の R 関数、4本）", h$options$manuscript_price, hw_model, 1e-12),
  cmp("HW：calibrate_hull_white − 基準の a・σ", c(h$fits$a[2], h$fits$sigma[2]), c(0.08, 0.012), 1e-9),
  cmp("BGM：固定ウェイト近似のボラ", api$bgm$proxy_vol, bgm_target, 0),
  cmp("BGM：相関の減衰の推定", api$bgm$fitted_decay, bgm_fit$minimum, 0),
  cmp("BGM（追加）：Rebonato の近似から推定した減衰 − 基準", api$bgm$rebonato_fitted_decay, api$bgm$decay, 1e-8)
)
options(width = 220)
print(rows |> select(item, n, max_abs_diff, tolerance, pass), n = Inf)
rows |> filter(nzchar(note)) |> distinct(note, .keep_all = TRUE) |> pwalk(\(item, note, ...) cat(item, "：", note, "\n"))
utils::write.csv(rows, file.path(out_dir, "calibration_diffs.csv"), row.names = FALSE)

golden <- list(
  engine = paste("GaussQuant", as.character(packageVersion("GaussQuant")), "QuantLib 1.42; the manuscript's R functions"),
  normal_price = manuscript_normal, sabr_par = as.list(gq_sabr_par), sabr_rmse = sqrt(gq_sabr_fit$value), sabr_fitted = gq_sabr_fitted,
  hw_market = hw_market$market_price, hw_par = as.list(hw_fit$par), hw_objective = hw_fit$value, hw_model = hw_model,
  bgm_proxy = bgm_target, bgm_decay = bgm_fit$minimum
)
write(toJSON(golden, auto_unbox = TRUE, digits = I(17), pretty = TRUE, na = "null"), file.path(lab, "server/tests/golden/calibration_golden.json"))
writeLines(c(paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")), golden$engine, paste("rmql", as.character(packageVersion("rmql")))),
           file.path(out_dir, "session_info.txt"))
stopifnot(all(rows$pass, na.rm = TRUE))
