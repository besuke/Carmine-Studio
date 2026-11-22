# Reconcile the OIS asset swap spread of one Curie demo offer: テスト円債B (JPTEST000022).
#
#   node ui/scripts/run-r.mjs server/tests/reconciliation/asw/reconcile_asw_jpy.R
#
# A. The old demo result: Curie output/offer_results_JPY_demo_20261006.xlsx (written 2026-10-27,
#    GaussQuant 2026.9.12.1 from GitHub fa721b2, QuantLib 1.42).
# B. Curie's function re-run now: compute_asset_swap_ISO() and instance_swap_curve() from Curie
#    (R/z0_utility/lagrange/), with the installed GaussQuant and QuantLib 1.42. Gives the component PVs.
# C. rmql: bootstrap_ois_curve() + create_fixed_rate_bond() + compute_ois_asset_swap(),
#    the path Carmine Studio's API uses.
# Nothing in Curie, GaussQuant or rmql is modified. Results go to server/tests/reconciliation/asw/results/.

suppressPackageStartupMessages({
  library(dplyr)
  library(readxl)
  library(rmql)
})

curie <- "C:/AnalyticFin/Projects/Curie"
out_dir <- "C:/AnalyticFin/Projects/Carmine-Studio/server/tests/reconciliation/asw/results"
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

isin <- "JPTEST000022"
valuation_date <- as.Date("2026-10-06")
asw_frequency <- 2L # Curie pricing_settings_Curie(): Semiannual, lag 0 (a demo assumption)
asw_lag <- 0L

# ---- Inputs (the same files Curie's demo used) -------------------------------------------------
attr <- readRDS(file.path(curie, "data/demo/attributes/demo_attributes_20261006.rds")) |> filter(ISIN == isin)
stopifnot(nrow(attr) == 1L)
ois <- read.delim(file.path(curie, "data/demo/market/demo_ois_JPY_20261006.txt"), sep = "|", encoding = "UTF-8")
old <- read_excel(file.path(curie, "output/offer_results_JPY_demo_20261006.xlsx"), sheet = "オファー結果") |> filter(ISIN == isin)
stopifnot(nrow(old) == 1L)
clean_price <- old$offer_price # 98.15, the demo offer (clean, per 100)

# ---- B. Curie's functions, re-run --------------------------------------------------------------
suppressPackageStartupMessages({ library(QuantLib); library(GaussQuant) })
source(file.path(curie, "R/z0_utility/lagrange/instance_swap_curve.R"), encoding = "UTF-8")
source(file.path(curie, "R/z0_utility/lagrange/compute_asset_swap_ISO.R"), encoding = "UTF-8")
source(file.path(curie, "R/z0_utility/bond_build.R"), encoding = "UTF-8")
curve_b <- instance_swap_curve("JPY", marketdate = valuation_date, quotes = ois) # log_cubic_discount, lag 0, Annual
row <- attr |> mutate(calculation_end_date = maturity_date)
GaussQuant::set_eval_date_GQL(GaussQuant::date_GQL(as.character(valuation_date)))
bond_b <- build_fixed_rate_bond_Curie(row)
asw_b <- compute_asset_swap_ISO(bond_b, clean_price, curve_b, payment_frequency = "Semiannual", payment_lag = asw_lag)
vb <- asw_b$valuation

# ---- C. rmql -------------------------------------------------------------------------
instruments <- create_ois_instruments(ois$tenor, ois$rate_pct / 100, 2L, 1L, 0L)
curve_c <- bootstrap_ois_curve(valuation_date, valuation_date, "tonar", "actual_365_fixed", instruments,
                               interpolation = "monotonic_log_cubic")
bond_c <- create_fixed_rate_bond(
  settlement_days = 2L, face_amount = 100,
  effective_date = attr$issue_date, termination_date = attr$maturity_date, tenor = "6M", calendar = "japan",
  convention = "unadjusted", termination_convention = "unadjusted", rule = "backward", end_of_month = FALSE,
  coupon_rate = attr$coupon_rate, day_count = "actual_365_fixed", payment_convention = "following", redemption = 100
)
vc <- compute_ois_asset_swap(bond_c, clean_price, curve_c, valuation_date, payment_frequency = asw_frequency, payment_lag = asw_lag)

# ---- Compare -----------------------------------------------------------------------------------
tol <- list(rate_bp = 1e-6, price = 1e-10, pv_per_100 = 1e-9)
rows <- tibble::tribble(
  ~item, ~unit, ~old_excel, ~curie_rerun, ~rmql, ~tolerance,
  "ASW 開始日", "date", as.numeric(old$asw_effective_date |> as.Date()), as.numeric(asw_b$effective_date), as.numeric(vc$effective_date), 0,
  "ASW 満期日", "date", as.numeric(old$asw_maturity_date |> as.Date()), as.numeric(asw_b$maturity_date), as.numeric(vc$maturity_date), 0,
  "経過利子（額面100あたり）", "price", old$accrued_per_100, vb$accrued_per_100, vc$accrued, tol$price,
  "ダーティ価格", "price", old$dirty_price, vb$dirty_price, vc$dirty_price, tol$price,
  "ASWスプレッド", "bp", old$native_asw_bp, vb$fair_spread_bp, vc$fair_spread_bp, tol$rate_bp,
  "スプレッドのアニュイティ", "per 100", NA, vb$spread_annuity, vc$spread_annuity, tol$pv_per_100,
  "債券レグPV（負）", "per 100", NA, vb$bond_leg_pv, vc$bond_leg_pv, tol$pv_per_100,
  "翌日物レグPV（スプレッド0）", "per 100", NA, vb$overnight_leg_pv, vc$overnight_leg_pv, tol$pv_per_100,
  "元本PV", "per 100", NA, vb$principal_pv, vc$principal_pv, tol$pv_per_100,
  "受渡日の価格調整PV", "per 100", NA, vb$upfront_pv, vc$upfront_pv, tol$pv_per_100
) |>
  mutate(
    rmql_minus_old = rmql - old_excel,
    rmql_minus_curie_rerun = rmql - curie_rerun,
    curie_rerun_minus_old = curie_rerun - old_excel,
    pass = (is.na(rmql_minus_old) | abs(rmql_minus_old) <= tolerance) & abs(rmql_minus_curie_rerun) <= tolerance
  )

options(width = 220, pillar.sigfig = 12)
print(rows |> select(item, unit, old_excel, curie_rerun, rmql, rmql_minus_old, rmql_minus_curie_rerun, tolerance, pass), n = 20)
utils::write.csv(rows, file.path(out_dir, "asw_JPTEST000022.csv"), row.names = FALSE)
writeLines(c(
  paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")),
  paste("R:", R.version.string),
  paste("QuantLib (R):", as.character(packageVersion("QuantLib"))),
  paste("GaussQuant (installed, for B):", as.character(packageVersion("GaussQuant"))),
  paste("rmql:", as.character(packageVersion("rmql")), "built", packageDescription("rmql")$Built),
  paste("Curie commit:", tryCatch(system2("git", c("-C", curie, "rev-parse", "--short", "HEAD"), stdout = TRUE), error = function(e) NA)),
  paste("old Excel modified:", format(file.info(file.path(curie, "output/offer_results_JPY_demo_20261006.xlsx"))$mtime)),
  paste("max quote error of curve B (bp):", max(abs(curve_b$quote_repricing$quote_error_bp))),
  paste("max reproduction error of curve C:", max(get_quote_repricing(curve_c)$reproduction_error))
), file.path(out_dir, "session_info.txt"))
cat(readLines(file.path(out_dir, "session_info.txt")), sep = "\n")
stopifnot(all(rows$pass))
