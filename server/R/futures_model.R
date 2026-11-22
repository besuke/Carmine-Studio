# JGB futures, CTD and futures BPV (Coral-Book II-2.6–2.7). All calculations are rmql; reconciled
# with GaussQuant and the manuscript's own results in server/tests/reconciliation/futures/ (difference 0).
#
# POST /api/futures/basket
#   {"mode": "current"}                                  fictitious prices and futures price (inputs.json)
#   {"mode": "flat", "yieldPct": 8, "fundingPct": 9}     every deliverable bond at one compound yield; the futures
#                                                         price is the 6% 10-year standard bond at that yield (II-2.7.3)
# Futures BPV = DV01 of the CTD / its conversion factor (GaussQuant futures_bpv_GQL), DV01 = half the clean-price
# change for -1bp and +1bp (GaussQuant bond_dv01_GQL). The yield from a price uses QuantLib's default accuracy 1e-8,
# as GaussQuant does.

FUT <- local({
  inp <- jsonlite::fromJSON(file.path(if (exists("script_dir")) script_dir else "server", "data", "futures_demo", "inputs.json"))
  inp$basket$issue_date <- as.Date(inp$basket$issue_date)
  inp$basket$maturity_date <- as.Date(inp$basket$maturity_date)
  inp
})
FUT_DC <- "actual_365_fixed"

fut_bond <- function(issue_date, maturity_date, coupon_pct) {
  rmql::create_fixed_rate_bond(
    settlement_days = 0L, face_amount = 100, effective_date = issue_date, termination_date = maturity_date, tenor = "6M",
    calendar = "japan", convention = "unadjusted", termination_convention = "unadjusted", rule = "backward", end_of_month = FALSE,
    coupon_rate = coupon_pct / 100, day_count = FUT_DC, payment_convention = "following", redemption = 100
  )
}
FUT_BONDS <- lapply(seq_len(nrow(FUT$basket)), function(i) fut_bond(FUT$basket$issue_date[i], FUT$basket$maturity_date[i], FUT$basket$coupon_pct[i]))
FUT_STANDARD <- fut_bond(as.Date(FUT$valuation_date), as.Date(FUT$stress$standard_maturity), 100 * FUT$stress$standard_coupon)

fut_price <- function(bond, y) rmql::compute_clean_price(bond, y, FUT_DC, "compounded", 2L, FUT$valuation_date)
fut_dv01 <- function(bond, y) (fut_price(bond, y - 1e-4) - fut_price(bond, y + 1e-4)) / 2

fut_basket <- function(prices, yields, futures_price, funding) {
  b <- FUT$basket
  basis <- rmql::compute_future_basket(FUT_BONDS, prices, futures_price, b$conversion_factor, funding, FUT$valuation_date, FUT$delivery_date)
  dur <- vapply(seq_along(FUT_BONDS), function(i) rmql::compute_duration(FUT_BONDS[[i]], yields[i], FUT_DC, "compounded", 2L, FUT$valuation_date, "modified"), 0)
  dv01 <- vapply(seq_along(FUT_BONDS), function(i) fut_dv01(FUT_BONDS[[i]], yields[i]), 0)
  bpv_ql <- vapply(seq_along(FUT_BONDS), function(i) rmql::compute_basis_point_value(FUT_BONDS[[i]], yields[i], FUT_DC, "compounded", 2L, FUT$valuation_date), 0)
  ctd <- which(basis$ctd)[1]
  list(
    rows = data.frame(issue = b$issue, coupon_pct = b$coupon_pct, maturity_date = format(b$maturity_date), conversion_factor = b$conversion_factor,
                      price = prices, yield = yields, duration = dur, dv01 = dv01, bpv_analytic = bpv_ql,
                      accrued_start = basis$accrued_start, accrued_end = basis$accrued_end, coupon_income = basis$coupon_income,
                      futures_invoice = basis$futures_invoice, gross_basis = basis$gross_basis, funding_cost = basis$funding_cost,
                      carry = basis$carry, net_basis = basis$net_basis, implied_repo = basis$implied_repo, ctd = basis$ctd),
    futures_price = futures_price, funding_rate = funding, ctd_issue = b$issue[ctd],
    futures_bpv = dv01[ctd] / b$conversion_factor[ctd], ctd_dv01 = dv01[ctd], ctd_conversion_factor = b$conversion_factor[ctd]
  )
}

fut_flat <- function(y, funding) {
  prices <- vapply(FUT_BONDS, fut_price, 0, y = y)
  fut_basket(prices, rep(y, length(prices)), fut_price(FUT_STANDARD, y), funding)
}

# CTD by yield level at a funding rate: where the CTD switches as the yield passes the 6% standard coupon.
# It depends only on the funding rate, so the result is kept per funding rate (a cache of a pure function).
FUT_LEVEL_CACHE <- new.env(parent = emptyenv())
fut_ctd_by_level <- function(funding) {
  key <- format(funding, digits = 17)
  if (!is.null(FUT_LEVEL_CACHE[[key]])) return(FUT_LEVEL_CACHE[[key]])
  out <- do.call(rbind, lapply(seq(1, 10, by = 0.25), function(lv) {
    r <- fut_flat(lv / 100, funding)
    i <- which(r$rows$issue == r$ctd_issue)
    data.frame(yield_pct = lv, ctd_issue = r$ctd_issue, ctd_duration = r$rows$duration[i], futures_price = r$futures_price, futures_bpv = r$futures_bpv)
  }))
  assign(key, out, envir = FUT_LEVEL_CACHE)
  out
}

fut_compute <- function(mode = "current", yield_pct = 8, funding_pct = NULL) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  if (!mode %in% c("current", "flat")) bad("mode must be \"current\" or \"flat\"")
  num_ok <- function(x, lo, hi) is.numeric(x) && length(x) == 1L && is.finite(x) && x >= lo && x <= hi
  if (mode == "current") {
    funding <- if (is.null(funding_pct)) FUT$funding_rate else { if (!num_ok(funding_pct, -1, 20)) bad("fundingPct must be within -1 and 20"); funding_pct / 100 }
    prices <- FUT$basket$fictitious_price
    yields <- vapply(seq_along(FUT_BONDS), function(i) rmql::compute_yield_from_price(
      FUT_BONDS[[i]], prices[i], "clean", FUT_DC, "compounded", 2L, FUT$valuation_date, accuracy = 1e-8), 0)
    res <- fut_basket(prices, yields, FUT$futures_price, funding)
  } else {
    if (!num_ok(yield_pct, 0.1, 15)) bad("yieldPct must be within 0.1 and 15")
    funding <- if (is.null(funding_pct)) yield_pct / 100 + 0.01 else { if (!num_ok(funding_pct, -1, 20)) bad("fundingPct must be within -1 and 20"); funding_pct / 100 }
    res <- fut_flat(yield_pct / 100, funding)
  }
  by_level <- fut_ctd_by_level(funding)
  c(list(
    mode = mode, valuation_date = FUT$valuation_date, delivery_date = FUT$delivery_date, flat_yield = if (mode == "flat") yield_pct / 100 else NA,
    inputs_note = FUT$note, current_curve = FUT$current_curve, stress_curve = FUT$stress$curve,
    conventions = list(bond = "日本国債：年2回利払、Actual/365 Fixed、受渡0日（評価日に受渡）、日付は調整なし、支払は Following",
                       yield = "複利利回り（年2回複利、Actual/365 Fixed）。価格からの逆算は QuantLib の既定の精度 1e-8（GaussQuant と同じ）",
                       carry = "Carry = 保有期間のクーポン ＋（受渡日の経過利子 − 評価日の経過利子）− Funding Cost、Funding Cost = ダーティ価格 × Funding Rate × 日数/365",
                       futures_bpv = "先物BPV = CTD の DV01 ÷ CF（GaussQuant futures_bpv_GQL）。DV01 = （−1bp の価格 − ＋1bp の価格）/ 2（額面100）",
                       engine = paste("rmql", as.character(utils::packageVersion("rmql"))))),
    res, list(ctd_by_level = by_level))
}
