# Reconcile the credit risk and CDS chapter (Coral Book II-5): GaussQuant / QuantLib 1.42 running the manuscript's
# code against the page's own model (server/R/cds_model.R, rmql), and that model against the manuscript's
# own results (rmql comparison/baseline/lagrange_values.csv). The inputs are the manuscript's illustrative values.
#
#   node ui/scripts/run-r.mjs server/tests/reconciliation/cds/reconcile_cds.R
#
# Writes server/tests/golden/cds_golden.json (GaussQuant's values) and server/tests/reconciliation/cds/results/.

suppressPackageStartupMessages({ library(GaussQuant); library(QuantLib); library(rmql); library(jsonlite) })

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/cds/results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
source(file.path(lab, "server/R/cds_model.R"))
api <- cds_compute(list())

# ---- GaussQuant: the manuscript's code (II-5.2–5.6) ----------------------------------------------------------
actual_365 <- QuantLib::Actual365Fixed(); actual_360 <- QuantLib::Actual360(); weekend_calendar <- QuantLib::WeekendsOnly()

trade_date_flat <- GaussQuant::date_GQL("2022-09-19"); maturity_date_flat <- GaussQuant::date_GQL("2023-09-20")
GaussQuant::set_eval_date_GQL(trade_date_flat)
notional_flat <- 10000000; risk_free_rate_flat <- 0.10; market_spread_flat <- 130 / 10000
contract_coupon_flat <- 100 / 10000; recovery_rate_flat <- 0.40
hazard_rate_approximation <- market_spread_flat / (1 - recovery_rate_flat)
cds_schedule_flat <- QuantLib::Schedule(trade_date_flat + 1L, maturity_date_flat, GaussQuant::period_months_GQL(3), weekend_calendar,
                                        "Following", "Unadjusted", "Forward", FALSE)
discount_curve_flat <- GaussQuant::flat_curve_GQL(reference_date = trade_date_flat, rate = risk_free_rate_flat, day_counter = actual_365, compounding = "Continuous")
discount_curve_handle_flat <- QuantLib::YieldTermStructureHandle(discount_curve_flat)
hazard_curve_flat <- QuantLib::FlatHazardRate(trade_date_flat, GaussQuant::quote_handle_GQL(hazard_rate_approximation), actual_365)
hazard_curve_handle_flat <- QuantLib::DefaultProbabilityTermStructureHandle(hazard_curve_flat)
cds_flat <- QuantLib::CreditDefaultSwap(GaussQuant::cds_buyer_side_GQL(), notional_flat, contract_coupon_flat, cds_schedule_flat, "Following", actual_360)
cds_flat$setPricingEngine(GaussQuant::cds_midpoint_engine_GQL(probability_handle = hazard_curve_handle_flat, recovery_rate = recovery_rate_flat,
                                                              discount_handle = discount_curve_handle_flat))
cds_cashflow_flat_tbl <- GaussQuant::cds_cashflow_table_GQL(cds_schedule = cds_schedule_flat, protection_start_date = cds_flat$protectionStartDate(),
  coupon_rate = contract_coupon_flat, hazard_curve = hazard_curve_flat, discount_curve = discount_curve_flat, trade_date = trade_date_flat, notional = notional_flat)
hand <- function(tbl, recovery, notional, rebate = 0) {
  premium <- -sum(tbl$coupon_amount * tbl$discount_factor * tbl$midpoint_survival_probability, na.rm = TRUE)
  unit <- (1 - recovery) * sum(tbl$midpoint_discount_factor * tbl$default_probability, na.rm = TRUE)
  rpv01 <- sum((tbl$accrual_days / 360) * tbl$discount_factor * tbl$midpoint_survival_probability, na.rm = TRUE)
  list(coupon_leg_npv = premium, default_leg_npv = notional * unit, npv = premium + notional * unit + rebate, risky_pv01 = rpv01, fair_spread = unit / rpv01)
}
flat_hand <- hand(cds_cashflow_flat_tbl, recovery_rate_flat, notional_flat)

cds_market_flat <- QuantLib::CreditDefaultSwap(GaussQuant::cds_buyer_side_GQL(), notional_flat, market_spread_flat, cds_schedule_flat, "Following", actual_360)
cds_market_npv_at_hazard <- function(hazard_rate) {
  cds_market_flat$setPricingEngine(GaussQuant::cds_midpoint_engine_GQL(recovery_rate = recovery_rate_flat, hazard_rate = hazard_rate,
    discount_rate = risk_free_rate_flat, reference_date = trade_date_flat, day_counter = "Actual365Fixed"))
  GaussQuant::cds_npv_GQL(cds_market_flat)
}
hazard_rate_calibrated <- stats::uniroot(cds_market_npv_at_hazard, interval = c(1e-8, 0.50), tol = 1e-10)$root

# II-5.4.2 grid with the calibrated hazard of each cell (the page's addition), the same uniroot on QuantLib's side
gq_grid_hazard <- vapply(seq_len(nrow(api$sensitivity)), function(i) {
  s <- api$sensitivity$market_spread_bp[i] / 1e4; r <- api$sensitivity$recovery[i]
  sw <- QuantLib::CreditDefaultSwap(GaussQuant::cds_buyer_side_GQL(), notional_flat, s, cds_schedule_flat, "Following", actual_360)
  f <- function(h) {
    sw$setPricingEngine(GaussQuant::cds_midpoint_engine_GQL(recovery_rate = r, hazard_rate = h, discount_rate = risk_free_rate_flat,
      reference_date = trade_date_flat, day_counter = "Actual365Fixed"))
    GaussQuant::cds_npv_GQL(sw)
  }
  stats::uniroot(f, c(1e-8, max(0.5, 3 * s / (1 - r))), tol = 1e-10)$root
}, 0)

trade_date_isda <- GaussQuant::date_GQL("2022-08-19")
GaussQuant::set_eval_date_GQL(trade_date_isda)
maturity_date_isda <- QuantLib::cdsMaturity(trade_date_isda, GaussQuant::period_years_GQL(5L), "CDS2015")
market_spread_isda <- 30.426 / 10000; contract_coupon_isda <- 100 / 10000; notional_isda <- 10000000
recovery_rate_isda <- 0.40; ois_discount_rate_isda <- 0.0025
cds_schedule_isda <- QuantLib::Schedule(trade_date_isda, maturity_date_isda, GaussQuant::period_months_GQL(3), QuantLib::WeekendsOnly(),
                                        "Following", "Unadjusted", "CDS2015", FALSE)
discount_curve_isda <- GaussQuant::flat_curve_GQL(reference_date = trade_date_isda, rate = ois_discount_rate_isda, day_counter = actual_365, compounding = "Continuous")
discount_curve_handle_isda <- QuantLib::YieldTermStructureHandle(discount_curve_isda)
make_isda <- function(spread, engine = NULL) GaussQuant::make_cds_GQL(maturity_date = maturity_date_isda, running_spread = spread, notional = notional_isda,
  side = "buyer", trade_date = trade_date_isda, coupon_tenor = "3M", day_counter = "Actual360", date_generation_rule = "CDS2015", pricing_engine = engine)
market_cds_isda <- make_isda(market_spread_isda)
isda_market_npv_at_hazard <- function(hazard_rate) {
  ph <- GaussQuant::flat_hazard_rate_GQL(hazard_rate = hazard_rate, reference_date = trade_date_isda, day_counter = "Actual365Fixed")
  market_cds_isda$setPricingEngine(GaussQuant::cds_isda_engine_GQL(hazard_curve_handle = ph, recovery_rate = recovery_rate_isda,
                                                                   discount_curve_handle = discount_curve_handle_isda))
  GaussQuant::cds_npv_GQL(market_cds_isda)
}
hazard_rate_isda <- stats::uniroot(isda_market_npv_at_hazard, interval = c(1e-8, 0.50), tol = 1e-10)$root
hazard_curve_isda <- QuantLib::FlatHazardRate(trade_date_isda, GaussQuant::quote_handle_GQL(hazard_rate_isda), actual_365)
hazard_curve_handle_isda <- QuantLib::DefaultProbabilityTermStructureHandle(hazard_curve_isda)
cds_isda <- make_isda(contract_coupon_isda, GaussQuant::cds_isda_engine_GQL(hazard_curve_handle = hazard_curve_handle_isda,
  recovery_rate = recovery_rate_isda, discount_curve_handle = discount_curve_handle_isda))
cds_mid <- make_isda(contract_coupon_isda, GaussQuant::cds_midpoint_engine_GQL(probability_handle = hazard_curve_handle_isda,
  recovery_rate = recovery_rate_isda, discount_handle = discount_curve_handle_isda))
legs <- function(x) list(npv = GaussQuant::cds_npv_GQL(x), coupon_leg_npv = x$couponLegNPV(), default_leg_npv = x$defaultLegNPV(),
                         accrual_rebate_npv = as.numeric(x$accrualRebateNPV()), fair_spread = GaussQuant::cds_fair_spread_GQL(x),
                         fair_upfront = as.numeric(x$fairUpfront()))
gq_isda <- legs(cds_isda); gq_mid <- legs(cds_mid)
cds_cashflow_isda_tbl <- GaussQuant::cds_cashflow_table_GQL(cds_schedule = cds_schedule_isda, protection_start_date = cds_isda$protectionStartDate(),
  coupon_rate = contract_coupon_isda, hazard_curve = hazard_curve_isda, discount_curve = discount_curve_isda, trade_date = trade_date_isda, notional = notional_isda)
isda_hand <- hand(cds_cashflow_isda_tbl, recovery_rate_isda, notional_isda, gq_isda$accrual_rebate_npv)
gq_schedule_isda <- format(GaussQuant::schedule_table_GQL(cds_schedule_isda)$schedule_date)

# ---- comparisons -------------------------------------------------------------------------------------------
base <- utils::read.csv("C:/AnalyticFin/Projects/RiemannQL/comparison/baseline/lagrange_values.csv", stringsAsFactors = FALSE)
bv <- function(key) base$value[match(key, base$key)]
cmp <- function(item, api_value, ref, tol) {
  d <- max(abs(as.numeric(api_value) - as.numeric(ref)))
  data.frame(item = item, n = length(api_value), max_abs_diff = d, tolerance = tol, pass = is.finite(d) && d <= tol)
}
cf_cols <- c("accrual_days", "coupon_amount", "discount_factor", "survival_probability", "default_probability",
             "midpoint_discount_factor", "midpoint_survival_probability")
cf_cmp <- function(label, a, g) do.call(rbind, lapply(cf_cols, function(k) {
  x <- a[[k]]; y <- g[[k]]; keep <- !(is.na(x) & is.na(y))
  cmp(sprintf("%s：%s", label, k), x[keep], y[keep], 1e-12 * max(1, max(abs(y[keep]))))
}))
f <- api$flat; s <- api$isda
rows <- rbind(
  cmp("1年物：Hazard 近似 s/(1−R)", f$hazard_approx, hazard_rate_approximation, 0),
  cmp("1年物：割引係数（満期）", f$discount_at_maturity, discount_curve_flat$discount(maturity_date_flat), 1e-15),
  cmp("1年物：生存確率（満期）", f$survival_at_maturity, hazard_curve_flat$survivalProbability(maturity_date_flat), 1e-15),
  cmp("1年物：NPV", f$value$npv, GaussQuant::cds_npv_GQL(cds_flat), 1e-8),
  cmp("1年物：Coupon Leg", f$value$coupon_leg_npv, cds_flat$couponLegNPV(), 1e-8),
  cmp("1年物：Default Leg", f$value$default_leg_npv, cds_flat$defaultLegNPV(), 1e-8),
  cmp("1年物：Fair Spread", f$value$fair_spread, GaussQuant::cds_fair_spread_GQL(cds_flat), 1e-15),
  cmp("1年物：Fair Upfront", f$value$fair_upfront, as.numeric(cds_flat$fairUpfront()), 1e-15),
  cmp("1年物：Schedule の日付（日数）", as.numeric(as.Date(f$cashflows$payment_date[-1])), as.numeric(as.Date(cds_cashflow_flat_tbl$payment_date[-1])), 0),
  cf_cmp("1年物 CF表", f$cashflows, cds_cashflow_flat_tbl),
  cmp("1年物：手計算 Premium Leg", f$hand$coupon_leg_npv, flat_hand$coupon_leg_npv, 1e-8),
  cmp("1年物：手計算 Protection Leg", f$hand$default_leg_npv, flat_hand$default_leg_npv, 1e-8),
  cmp("1年物：手計算 Risky PV01", f$hand$risky_pv01, flat_hand$risky_pv01, 1e-15),
  cmp("1年物：手計算 Fair Spread", f$hand$fair_spread, flat_hand$fair_spread, 1e-15),
  cmp("1年物：ゼロNPVの Hazard Rate", f$calibration$hazard, hazard_rate_calibrated, 1e-10),
  cmp("感応度：9通りの近似 Hazard", api$sensitivity$hazard_approx, api$sensitivity$market_spread_bp / 1e4 / (1 - api$sensitivity$recovery), 0),
  cmp("感応度：9通りのゼロNPV Hazard", api$sensitivity$hazard_calibrated, gq_grid_hazard, 1e-10),
  cmp("標準5年物：満期（シリアル）", s$maturity_serial, as.numeric(as.Date(GaussQuant::iso_GQL(maturity_date_isda))), 0),
  cmp("標準5年物：CDS2015 Schedule（日数）", as.numeric(as.Date(s$schedule)), as.numeric(as.Date(gq_schedule_isda)), 0),
  cmp("標準5年物：割引係数（満期）", s$discount_at_maturity, discount_curve_isda$discount(maturity_date_isda), 1e-15),
  cmp("標準5年物：ゼロNPVの Hazard Rate", s$hazard, hazard_rate_isda, 1e-10),
  cmp("ISDA：NPV", s$isda$npv, gq_isda$npv, 1e-8),
  cmp("ISDA：Coupon Leg", s$isda$coupon_leg_npv, gq_isda$coupon_leg_npv, 1e-8),
  cmp("ISDA：Default Leg", s$isda$default_leg_npv, gq_isda$default_leg_npv, 1e-8),
  cmp("ISDA：Accrual Rebate", s$isda$accrual_rebate_npv, gq_isda$accrual_rebate_npv, 1e-8),
  cmp("ISDA：Fair Spread", s$isda$fair_spread, gq_isda$fair_spread, 1e-15),
  cmp("ISDA：Fair Upfront", s$isda$fair_upfront, gq_isda$fair_upfront, 1e-15),
  cmp("MidPoint（標準5年物）：NPV", s$midpoint$npv, gq_mid$npv, 1e-8),
  cmp("MidPoint（標準5年物）：Coupon Leg", s$midpoint$coupon_leg_npv, gq_mid$coupon_leg_npv, 1e-8),
  cmp("MidPoint（標準5年物）：Default Leg", s$midpoint$default_leg_npv, gq_mid$default_leg_npv, 1e-8),
  cmp("MidPoint（標準5年物）：Fair Spread", s$midpoint$fair_spread, gq_mid$fair_spread, 1e-15),
  cf_cmp("標準5年物 CF表", s$cashflows, cds_cashflow_isda_tbl),
  cmp("標準5年物：手計算 Premium Leg", s$hand$coupon_leg_npv, isda_hand$coupon_leg_npv, 1e-8),
  cmp("標準5年物：手計算 Protection Leg", s$hand$default_leg_npv, isda_hand$default_leg_npv, 1e-8),
  cmp("標準5年物：手計算 Fair Spread", s$hand$fair_spread, isda_hand$fair_spread, 1e-15),
  # against the manuscript's own run
  cmp("原稿：1年物 NPV", f$value$npv, bv("cds.flat.npv"), 1e-8),
  cmp("原稿：1年物 Fair Spread（bp）", 1e4 * f$value$fair_spread, bv("cds.flat.fair_spread_bp"), 1e-10),
  cmp("原稿：1年物 Coupon Leg", f$value$coupon_leg_npv, bv("cds.flat.coupon_leg"), 1e-8),
  cmp("原稿：1年物 Default Leg", f$value$default_leg_npv, bv("cds.flat.default_leg"), 1e-8),
  cmp("原稿：1年物 ゼロNPV Hazard（%）", 100 * f$calibration$hazard, bv("cds.flat.hazard_pct"), 1e-8),
  cmp("原稿：標準5年物 満期（シリアル）", s$maturity_serial, bv("cds.isda.maturity"), 0),
  cmp("原稿：ISDA Hazard", s$hazard, bv("cds.isda.hazard"), 1e-10),
  cmp("原稿：ISDA NPV", s$isda$npv, bv("cds.isda.npv"), 1e-8),
  cmp("原稿：ISDA Coupon Leg", s$isda$coupon_leg_npv, bv("cds.isda.coupon_leg"), 1e-8),
  cmp("原稿：ISDA Default Leg", s$isda$default_leg_npv, bv("cds.isda.default_leg"), 1e-8),
  cmp("原稿：ISDA Accrual Rebate", s$isda$accrual_rebate_npv, bv("cds.isda.rebate"), 1e-8),
  cmp("原稿：ISDA Fair Spread（bp）", 1e4 * s$isda$fair_spread, bv("cds.isda.fair_spread_bp"), 1e-10),
  cmp("原稿：ISDA Fair Upfront（%）", 100 * s$isda$fair_upfront, bv("cds.isda.fair_upfront_pct"), 1e-12),
  cmp("原稿：MidPoint NPV", s$midpoint$npv, bv("cds.midpoint.npv"), 1e-8),
  cmp("原稿：MidPoint Coupon Leg", s$midpoint$coupon_leg_npv, bv("cds.midpoint.coupon_leg"), 1e-8),
  cmp("原稿：MidPoint Default Leg", s$midpoint$default_leg_npv, bv("cds.midpoint.default_leg"), 1e-8),
  cmp("原稿：MidPoint Fair Spread（bp）", 1e4 * s$midpoint$fair_spread, bv("cds.midpoint.fair_spread_bp"), 1e-10)
)
rownames(rows) <- NULL
options(width = 200)
print(rows, digits = 3)
utils::write.csv(rows, file.path(out_dir, "cds_diffs.csv"), row.names = FALSE)
golden <- list(
  engine = paste("GaussQuant", as.character(packageVersion("GaussQuant")), "QuantLib 1.42"),
  flat = list(npv = GaussQuant::cds_npv_GQL(cds_flat), coupon_leg_npv = cds_flat$couponLegNPV(), default_leg_npv = cds_flat$defaultLegNPV(),
              fair_spread = GaussQuant::cds_fair_spread_GQL(cds_flat), fair_upfront = as.numeric(cds_flat$fairUpfront()),
              hazard_calibrated = hazard_rate_calibrated, cashflows = as.data.frame(cds_cashflow_flat_tbl), hand = flat_hand),
  sensitivity_hazard_calibrated = gq_grid_hazard,
  isda = c(gq_isda, list(hazard = hazard_rate_isda, maturity = GaussQuant::iso_GQL(maturity_date_isda), schedule = gq_schedule_isda,
                         cashflows = as.data.frame(cds_cashflow_isda_tbl), hand = isda_hand)),
  midpoint = gq_mid
)
write(toJSON(golden, auto_unbox = TRUE, digits = I(17), pretty = TRUE, na = "null"), file.path(lab, "server/tests/golden/cds_golden.json"))
writeLines(c(paste("run_at:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")), golden$engine, paste("rmql", as.character(packageVersion("rmql")))),
           file.path(out_dir, "session_info.txt"))
stopifnot(all(rows$pass))
