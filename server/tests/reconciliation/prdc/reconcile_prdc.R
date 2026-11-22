# Reconcile the PRDC chapter (Coral Book II-9): the page's own model (server/R/prdc_model.R, rmql)
# against QuantLib (schedule, blackFormula), against the manuscript's own code run with GaussQuant (Monte Carlo with
# QuantLib's random numbers, read from the qmd), and against the manuscript's results (rmql baseline).
#
#   npm run reconcile:prdc
#
# Writes server/tests/golden/prdc_golden.json and server/tests/reconciliation/prdc/results/.

suppressPackageStartupMessages({
  library(GaussQuant)
  library(QuantLib)
  library(rmql)
  library(dplyr)
  library(purrr)
  library(tibble)
  library(jsonlite)
})

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/prdc/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
source(file.path(lab, "server/R/prdc_model.R"))
api <- prdc_compute(list())
n <- api$note

# ---- the manuscript's code, read from the qmd and run as it is (tables printed by it are discarded) ----------------
qmd <- "C:/AnalyticFin/Projects/coral-book/part2_quantive_riemann/ch09_exotic_derivatives_prdc.qmd"
lines <- readLines(qmd, encoding = "UTF-8")
chunk_code <- function(label) {
  start <- grep(sprintf("^```\\{r %s\\}$", label), lines)
  stopifnot(length(start) == 1L)
  end <- start + which(lines[(start + 1):length(lines)] == "```")[1]
  lines[(start + 1):(end - 1)]
}
ms <- new.env()
ms$show_plot_LFL <- function(...) invisible(NULL)
for (label in c("product-inputs", "coupon-schedules", "market-curves", "fx-process", "coupon-payoff", "time-grid",
                "prdc-valuation", "spot-sensitivity", "volatility-sensitivity")) {
  invisible(capture.output(eval(parse(text = chunk_code(label)), envir = ms)))
}

# ---- QuantLib references -------------------------------------------------------------------------------------------
s <- PRDC_SCHEDULE
ql_dates <- as.Date(GaussQuant::schedule_table_GQL(ms$coupon_schedule_prdc)$schedule_date)
forward <- 133.2681 * exp((0.01 - 0.03) * s$times)
deviation <- 0.10 * sqrt(s$times)
ql_call <- function(k) map2_dbl(forward, deviation, \(f, d) QuantLib::blackFormula(QuantLib::Option_Call_get(), k, f, d, 1))
low <- 120 * 0.10 / 0.122; high <- 120 * (0.10 + 0.022) / 0.122
ql_expected <- 0.122 / 120 * (ql_call(low) - ql_call(high))
ql_npv <- 3e8 * (sum(s$accruals * ql_expected * exp(-0.005 * s$times)) + exp(-0.005 * max(s$times)))
d2 <- function(k) (log(forward / k) - deviation^2 / 2) / deviation
ql_floor_prob <- pnorm(-d2(low)); ql_cap_prob <- pnorm(d2(high))

# ---- comparisons -----------------------------------------------------------------------------------------------
base <- utils::read.csv("C:/AnalyticFin/Projects/RiemannQL/comparison/baseline/lagrange_values.csv", stringsAsFactors = FALSE)
bv <- function(key) base$value[match(key, base$key)]
cmp <- function(item, a, ref, tol, note = "") {
  d <- max(abs(as.numeric(a) - as.numeric(ref)))
  tibble(item = item, n = length(a), max_abs_diff = d, tolerance = tol, pass = is.finite(d) && d <= tol, note = note)
}
info <- function(item, a, ref, note) tibble(item = item, n = length(a), max_abs_diff = max(abs(as.numeric(a) - as.numeric(ref))), tolerance = NA_real_, pass = NA, note = note)
ms_npv <- ms$prdc_present_value_jpy
ms_se <- ms$prdc_result$summary$value[ms$prdc_result$summary$metric == "standard_error"]
if (!length(ms_se)) ms_se <- bv("prdc.standard_error")
ms_exp <- ms$expected_coupon_tbl$final_coupon_rate
ms_spot <- ms$spot_sensitivity_tbl$prdc_npv
ms_vol <- ms$volatility_sensitivity_tbl$prdc_npv
rows <- bind_rows(
  cmp("クーポン日（全53日、RFM − QuantLib）", as.numeric(as.Date(n$schedule$full)), as.numeric(ql_dates), 0),
  cmp("残りのクーポン日（37日）", as.numeric(as.Date(n$coupons$coupon_date)), as.numeric(ms$fx_path_generator_prdc$remaining_coupon_dates), 0),
  cmp("クーポン日までの年数（Actual/360）", n$coupons$time, ms$fx_path_generator_prdc$coupon_times, 1e-14),
  cmp("フロア・キャップに到達する FX", c(n$thresholds$floor_fx, n$thresholds$cap_fx), c(ms$fx_floor_threshold_prdc, ms$fx_cap_threshold_prdc), 1e-12),
  cmp("クーポンのペイオフ（70〜180）", n$payoff$coupon_rate[n$payoff$fx_rate %in% ms$fx_payoff_grid_tbl$fx_rate],
      ms$fx_payoff_grid_tbl$coupon_rate, 1e-15),
  cmp("期待クーポン（37日、RFM − QuantLib blackFormula）", n$coupons$expected_coupon_rate, ql_expected, 1e-15),
  cmp("フロアに到達する確率（RFM − 正規分布の式）", n$coupons$floor_probability, ql_floor_prob, 1e-12),
  cmp("キャップに到達する確率（RFM − 正規分布の式）", n$coupons$cap_probability, ql_cap_prob, 1e-12),
  cmp("現在価値・閉じた式（RFM − QuantLib blackFormula、円）", n$closed$npv, ql_npv, 1e-6),
  cmp("キャッシュフローの現在価値の合計 − 閉じた式（円）", sum(n$coupons$total_present_value), n$closed$npv, 1e-6),
  cmp("原稿のコードを再実行した MC − 原稿の結果（円）", ms_npv, bv("prdc.npv"), 1e-6),
  cmp("原稿のコードを再実行したスポット感応度 − 原稿の結果（円）", ms_spot, bv(paste0("prdc.spot.", ms$spot_sensitivity_tbl$scenario)), 1e-6),
  info("現在価値：閉じた式 − 原稿の MC（300本）", n$closed$npv, ms_npv,
       sprintf("判定しない：モンテカルロの標本誤差。差は原稿の標準誤差 %.0f 円の %.2f 倍", ms_se, (n$closed$npv - ms_npv) / ms_se)),
  info("期待クーポン：閉じた式 − 原稿の MC（37日）", n$coupons$expected_coupon_rate, ms_exp, "判定しない：300本の標本平均"),
  info("スポット感応度：閉じた式 − 原稿の MC（100本、5通り）", n$spot_scenarios$npv, ms_spot, "判定しない：100本の標本平均（共通乱数）"),
  info("ボラ感応度：閉じた式 − 原稿の MC（100本、5通り）", n$vol_scenarios$npv, ms_vol, "判定しない：100本の標本平均（共通乱数）"),
  info("MC（RFM、3000本）− 閉じた式", api$mc$npv, n$closed$npv,
       sprintf("判定しない：差は標準誤差 %.0f 円の %.2f 倍", api$mc$standard_error, (api$mc$npv - n$closed$npv) / api$mc$standard_error))
)
options(width = 220)
print(rows |> select(item, n, max_abs_diff, tolerance, pass), n = Inf)
rows |> filter(nzchar(note)) |> pwalk(\(item, note, ...) cat(item, "：", note, "\n"))
utils::write.csv(rows, file.path(out_dir, "prdc_diffs.csv"), row.names = FALSE)

golden <- list(
  engine = "QuantLib blackFormula and schedule; the manuscript's Monte Carlo through GaussQuant",
  schedule = format(ql_dates), expected_coupon = ql_expected, floor_probability = ql_floor_prob, cap_probability = ql_cap_prob,
  npv_closed = ql_npv, manuscript_mc_npv = ms_npv, manuscript_mc_se = ms_se
)
write(toJSON(golden, auto_unbox = TRUE, digits = I(17), pretty = TRUE, na = "null"), file.path(lab, "server/tests/golden/prdc_golden.json"))
writeLines(c(paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")), "QuantLib 1.42, GaussQuant", paste("rmql", as.character(packageVersion("rmql")))),
           file.path(out_dir, "session_info.txt"))
stopifnot(all(rows$pass, na.rm = TRUE))
