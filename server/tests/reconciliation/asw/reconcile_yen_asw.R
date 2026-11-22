# Reconcile the yen-converted ASW of one Curie demo offer: TEST USD BOND F 4.25% 2029 (USTEST000016).
#
#   node ui/scripts/run-r.mjs server/tests/reconciliation/asw/reconcile_yen_asw.R
#
# A. Old demo result: Curie output/offer_results_ISO_demo_20261006.xlsx (2026-10-27, GaussQuant 2026.9.12.1, QuantLib 1.42).
# B. Curie's functions re-run now: compute_asset_swap_basis_JPY() with the basis interpolated by Curie's
#    spline_by_maturity_Curie() (stats::splinefun natural), installed GaussQuant and QuantLib 1.42.
# C. Carmine Studio's API path: basis interpolation in server/R/asw_model.R and rmql compute_yen_asset_swap().
# Nothing in Curie, GaussQuant or rmql is modified.

suppressPackageStartupMessages({ library(dplyr); library(readxl) })

curie <- "C:/AnalyticFin/Projects/Curie"
lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/asw/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
isin <- "USTEST000016"
valuation_date <- as.Date("2026-10-06")

old <- read_excel(file.path(curie, "output/offer_results_ISO_demo_20261006.xlsx"), sheet = "オファー結果") |> filter(ISIN == isin)
stopifnot(nrow(old) == 1L)

# ---- C. The API's own code path ----------------------------------------------------------------
script_dir <- file.path(lab, "server")
source(file.path(script_dir, "R", "asw_model.R"))
row <- Filter(function(r) identical(r$offer$ISIN, isin), asw_offer_rows())[[1]]
priced <- asw_price(row, detail = TRUE)
yc <- priced$yen

# ---- B. Curie's functions ----------------------------------------------------------------------
suppressPackageStartupMessages({ library(QuantLib); library(GaussQuant) })
for (f in c("lagrange/instance_swap_curve.R", "lagrange/compute_asset_swap_ISO.R", "lagrange/compute_asset_swap_basis_JPY.R",
            "bond_build.R", "interpolation.R")) source(file.path(curie, "R/z0_utility", f), encoding = "UTF-8")
read_pipe <- function(f) utils::read.delim(file.path(curie, "data/demo/market", f), sep = "|", encoding = "UTF-8", stringsAsFactors = FALSE)
attr <- readRDS(file.path(curie, "data/demo/attributes/demo_attributes_20261006.rds")) |> filter(ISIN == isin)
usd_curve <- instance_swap_curve("USD", marketdate = valuation_date, quotes = read_pipe("demo_ois_USD_20261006.txt"))
jpy_curve <- instance_swap_curve("JPY", marketdate = valuation_date, quotes = read_pipe("demo_ois_JPY_20261006.txt"))
basis <- read_pipe("demo_basis_20261006.txt") |>
  filter(currency_pair == "USDJPY", spread_leg == "JPY", pay_leg == "USD SOFR flat", receive_leg == "JPY TONAR + basis_bp",
         notional_type == "constant", collateral_currency == "JPY") |>
  mutate(maturity_date = as.Date(maturity_date)) |>
  summarise(basis_bp_mean = mean(basis_bp), .by = maturity_date) |> arrange(maturity_date)
basis_b <- spline_by_maturity_Curie(basis$maturity_date, basis$basis_bp_mean, valuation_date, attr$maturity_date, "ベーシス気配")$value
fx <- read_pipe("demo_fx_20261006.txt") |> filter(base_currency == "USD")
GaussQuant::set_eval_date_GQL(GaussQuant::date_GQL(as.character(valuation_date)))
bond_b <- build_fixed_rate_bond_Curie(attr |> mutate(calculation_end_date = maturity_date))
yb <- compute_asset_swap_basis_JPY(bond_b, old$offer_price, usd_curve, jpy_curve, fx$fx_spot, basis_b, currency = "USD")$valuation

# ---- Compare ------------------------------------------------------------------------------------
tol <- list(bp = 1e-6, yen_per_100 = 1e-7, residual = 1e-6)
rows <- tibble::tribble(
  ~item, ~old_excel, ~curie_rerun, ~api_rmql, ~tolerance,
  "FX スポット（円/USD）", old$fx_spot, fx$fx_spot, yc$fx_spot, 0,
  "ベーシス（補間後、bp）", old$basis_bp, basis_b, yc$basis_bp, tol$bp,
  "発行通貨建て ASW（bp）", old$native_asw_bp, yb$native_asw_bp, priced$summary$fair_spread_bp, tol$bp,
  "円換算 ASW（bp）", old$jpy_asw_bp, yb$jpy_asw_bp, yc$yen_asw_bp, tol$bp,
  "単純和（bp）", old$simple_sum_bp, yb$simple_sum_bp, yc$simple_sum_bp, tol$bp,
  "外貨割引の一定スプレッド z（bp）", old$calibrated_discount_spread_bp, yb$calibrated_discount_spread_bp, yc$calibrated_discount_spread_bp, tol$bp,
  "ヘッジ後の債券PV（円、額面100）", NA, yb$hedged_bond_pv_jpy, yc$hedged_bond_pv_yen, tol$yen_per_100,
  "円の基準レグPV（円、額面100）", NA, yb$jpy_base_leg_pv, yc$yen_base_leg_pv, tol$yen_per_100,
  "価格調整PV（円、額面100）", NA, yb$upfront_pv_jpy, yc$upfront_pv_yen, tol$yen_per_100,
  "円のスプレッド・アニュイティ（円、額面100）", NA, yb$spread_annuity_jpy, yc$spread_annuity_yen, tol$yen_per_100
) |>
  mutate(api_minus_old = api_rmql - old_excel, api_minus_curie_rerun = api_rmql - curie_rerun,
         pass = (is.na(api_minus_old) | abs(api_minus_old) <= tolerance) & abs(api_minus_curie_rerun) <= tolerance)

residuals <- tibble::tibble(
  item = c("CCS 校正の残差（円、額面100）", "フェアスプレッドでの NPV（円、額面100）"),
  old_excel = c(old$ccs_repricing_npv_jpy, old$fair_spread_npv_jpy),
  curie_rerun = c(yb$ccs_repricing_npv_jpy, yb$fair_spread_npv_jpy),
  api_rmql = c(yc$detail$checks$ccs_residual_yen, yc$detail$checks$npv_at_fair_spread_yen),
  tolerance = tol$residual
) |> mutate(pass = abs(api_rmql) <= tolerance)

options(width = 220, pillar.sigfig = 14)
print(rows |> select(item, old_excel, curie_rerun, api_rmql, api_minus_old, api_minus_curie_rerun, tolerance, pass), n = 20)
print(residuals)
utils::write.csv(rows, file.path(out_dir, "yen_asw_USTEST000016.csv"), row.names = FALSE)
utils::write.csv(residuals, file.path(out_dir, "yen_asw_USTEST000016_residuals.csv"), row.names = FALSE)
stopifnot(all(rows$pass), all(residuals$pass))
cat("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z"), "\n")
