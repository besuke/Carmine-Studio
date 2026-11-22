# Credit risk and CDS (Coral-Book II-5). All calculations are rmql; reconciled with GaussQuant running
# the manuscript's code, and with the manuscript's own results, in server/tests/reconciliation/cds/ (difference 0).
#
# POST /api/cds
#   {"flat": {"spreadBp": 130, "couponBp": 100, "recoveryPct": 40, "ratePct": 10},
#    "isda": {"spreadBp": 30.426, "couponBp": 100, "recoveryPct": 40, "ratePct": 0.25}}
# Every field is optional; the defaults are the manuscript's examples (illustrative values, not market data).
#
# II-5.2–5.4  one-year swap, trade 2022-09-19, schedule 2022-09-20 to 2023-09-20 (3M, weekends only, following,
#             unadjusted at the end, forward), plain QuantLib constructor, MidPoint engine, flat continuous rate.
# II-5.5–5.6  standard five-year swap, trade 2022-08-19, CDS2015 maturity, made as QuantLib's MakeCreditDefaultSwap
#             (GaussQuant make_cds_GQL): protection and trade date on the trade date, last coupon counts its last day.
# The hazard rate at zero NPV uses R's uniroot on (1e-8, 0.5), tol 1e-10, as the manuscript does.

CDS_FLAT_DATES <- list(trade = "2022-09-19", start = "2022-09-20", maturity = "2023-09-20")
CDS_ISDA_TRADE <- "2022-08-19"
CDS_NOTIONAL <- 1e7
CDS_HAZARD_END <- "2060-01-01"
CDS_DEFAULTS <- list(flat = list(spreadBp = 130, couponBp = 100, recoveryPct = 40, ratePct = 10),
                     isda = list(spreadBp = 30.426, couponBp = 100, recoveryPct = 40, ratePct = 0.25))

cds_rates <- function(date, rate) rmql::create_flat_curve(date, rate, "actual_365_fixed", "continuous")
cds_hazard <- function(date, h) rmql::create_hazard_curve(date, CDS_HAZARD_END, h)
cds_value <- function(swap, h, recovery, rates, date, engine) {
  as.list(rmql::compute_cds_value(swap, cds_hazard(date, h), recovery, rates, date, engine))
}
# Flat hazard rate at which the swap's NPV is zero. The interval is the manuscript's unless the spread needs more.
cds_calibrate <- function(npv_at, approx) {
  stats::uniroot(npv_at, c(1e-8, max(0.5, 3 * approx)), tol = 1e-10)$root
}

# The manuscript's cash-flow and probability table (GaussQuant cds_cashflow_table_GQL): the first row is the
# protection start; the midpoint of a period is the earlier payment date plus half the days, rounded down.
cds_cashflow_table <- function(schedule_dates, protection_start, coupon, hazard_curve, rates, trade, notional) {
  n <- length(schedule_dates)
  pay <- c(as.Date(protection_start), schedule_dates[-1])
  start <- c(as.Date(NA), schedule_dates[-n])
  days <- as.numeric(pay - start)
  on_curve <- pay > as.Date(trade)
  df <- ifelse(on_curve, rmql::compute_discount(rates, pay), 1)
  q <- ifelse(on_curve, rmql::compute_survival_probability(hazard_curve, pay), 1)
  mid <- c(as.Date(NA), pay[-n] + floor(as.numeric(pay[-1] - pay[-n]) / 2))
  data.frame(
    payment_date = format(pay), accrual_start = format(start), accrual_days = days,
    coupon_amount = notional * coupon * days / 360, discount_factor = df, survival_probability = q,
    default_probability = c(0, -diff(q)), midpoint_date = format(mid),
    midpoint_discount_factor = c(NA, rmql::compute_discount(rates, mid[-1])),
    midpoint_survival_probability = c(NA, rmql::compute_survival_probability(hazard_curve, mid[-1]))
  )
}
# II-5.3 and II-5.6.5: premium leg, protection leg, risky PV01 and fair spread from the table.
cds_hand <- function(tbl, recovery, notional, rebate = 0) {
  premium <- -sum(tbl$coupon_amount * tbl$discount_factor * tbl$midpoint_survival_probability, na.rm = TRUE)
  protection_unit <- (1 - recovery) * sum(tbl$midpoint_discount_factor * tbl$default_probability, na.rm = TRUE)
  rpv01 <- sum(tbl$accrual_days / 360 * tbl$discount_factor * tbl$midpoint_survival_probability, na.rm = TRUE)
  list(coupon_leg_npv = premium, default_leg_npv = notional * protection_unit, npv = premium + notional * protection_unit + rebate,
       risky_pv01 = rpv01, protection_leg_per_unit = protection_unit, fair_spread = protection_unit / rpv01)
}

cds_flat <- function(p) {
  d <- CDS_FLAT_DATES
  spread <- p$spreadBp / 1e4; coupon <- p$couponBp / 1e4; recovery <- p$recoveryPct / 100; rate <- p$ratePct / 100
  approx <- spread / (1 - recovery)
  rates <- cds_rates(d$trade, rate)
  swap <- function(s) rmql::create_credit_default_swap("buyer", CDS_NOTIONAL, s, d$start, d$maturity)
  contract <- swap(coupon)
  value <- cds_value(contract, approx, recovery, rates, d$trade, "midpoint")
  sched <- rmql::generate_schedule(d$start, d$maturity, "3M", "weekends_only", "following", "unadjusted", "forward")$date
  tbl <- cds_cashflow_table(sched, d$start, coupon, cds_hazard(d$trade, approx), rates, d$trade, CDS_NOTIONAL)
  market <- swap(spread)
  calibrated <- cds_calibrate(function(h) cds_value(market, h, recovery, rates, d$trade, "midpoint")$npv, approx)
  at_calibrated <- cds_value(market, calibrated, recovery, rates, d$trade, "midpoint")
  t <- seq(0, 5, by = 0.25)
  list(
    trade_date = d$trade, protection_start = d$start, maturity_date = d$maturity, notional = CDS_NOTIONAL,
    spread = spread, coupon = coupon, recovery = recovery, rate = rate, hazard_approx = approx,
    probability_curve = data.frame(time = t, survival_probability = exp(-approx * t), default_probability = 1 - exp(-approx * t)),
    discount_at_maturity = rmql::compute_discount(rates, d$maturity),
    survival_at_maturity = rmql::compute_survival_probability(cds_hazard(d$trade, approx), d$maturity),
    value = value, cashflows = tbl, hand = cds_hand(tbl, recovery, CDS_NOTIONAL),
    calibration = list(hazard = calibrated, npv = at_calibrated$npv, fair_spread = at_calibrated$fair_spread)
  )
}

# II-5.4.2: the manuscript's grid of spreads and recoveries (lambda ~ s / (1 - R)), with the hazard rate at zero NPV
# of the one-year swap beside it (an addition of this page).
cds_sensitivity <- function(rate) {
  d <- CDS_FLAT_DATES
  rates <- cds_rates(d$trade, rate)
  g <- expand.grid(recovery = c(0.2, 0.4, 0.6), market_spread_bp = c(50, 100, 200))[, c("market_spread_bp", "recovery")]
  g$loss_given_default <- 1 - g$recovery
  g$hazard_approx <- g$market_spread_bp / 1e4 / g$loss_given_default
  g$survival_probability_5y <- exp(-5 * g$hazard_approx)
  g$default_probability_5y <- 1 - g$survival_probability_5y
  g$hazard_calibrated <- vapply(seq_len(nrow(g)), function(i) {
    swap <- rmql::create_credit_default_swap("buyer", CDS_NOTIONAL, g$market_spread_bp[i] / 1e4, d$start, d$maturity)
    cds_calibrate(function(h) cds_value(swap, h, g$recovery[i], rates, d$trade, "midpoint")$npv, g$hazard_approx[i])
  }, 0)
  g
}

cds_isda <- function(p) {
  trade <- CDS_ISDA_TRADE
  spread <- p$spreadBp / 1e4; coupon <- p$couponBp / 1e4; recovery <- p$recoveryPct / 100; rate <- p$ratePct / 100
  maturity <- rmql::compute_cds_maturity(trade, "5Y", "cds2015")
  rates <- cds_rates(trade, rate)
  swap <- function(s) rmql::create_credit_default_swap(
    "buyer", CDS_NOTIONAL, s, trade, maturity, rule = "cds2015", trade_date = trade, protection_start = trade,
    last_period_day_count = "actual_360_include_last_day")
  market <- swap(spread)
  approx <- spread / (1 - recovery)
  hazard <- cds_calibrate(function(h) cds_value(market, h, recovery, rates, trade, "isda")$npv, approx)
  standard <- swap(coupon)
  isda <- cds_value(standard, hazard, recovery, rates, trade, "isda")
  midpoint <- cds_value(standard, hazard, recovery, rates, trade, "midpoint")
  sched <- rmql::generate_schedule(trade, maturity, "3M", "weekends_only", "following", "unadjusted", "cds2015")$date
  tbl <- cds_cashflow_table(sched, trade, coupon, cds_hazard(trade, hazard), rates, trade, CDS_NOTIONAL)
  list(
    trade_date = trade, maturity_date = format(maturity), maturity_serial = as.numeric(maturity), notional = CDS_NOTIONAL,
    spread = spread, coupon = coupon, recovery = recovery, rate = rate,
    schedule = format(sched), discount_at_maturity = rmql::compute_discount(rates, maturity),
    hazard = hazard, hazard_approx = approx,
    survival_at_maturity = rmql::compute_survival_probability(cds_hazard(trade, hazard), maturity),
    isda = isda, fair_upfront_amount = isda$fair_upfront * CDS_NOTIONAL, midpoint = midpoint,
    cashflows = tbl, hand = cds_hand(tbl, recovery, CDS_NOTIONAL, isda$accrual_rebate_npv)
  )
}

# The fair upfront of the standard swap as the market spread moves, the coupon fixed (an addition of this page).
CDS_UPFRONT_CACHE <- new.env(parent = emptyenv())
cds_upfront_by_spread <- function(p) {
  key <- paste(format(c(p$couponBp, p$recoveryPct, p$ratePct), digits = 17), collapse = "|")
  if (!is.null(CDS_UPFRONT_CACHE[[key]])) return(CDS_UPFRONT_CACHE[[key]])
  out <- do.call(rbind, lapply(seq(10, 300, by = 10), function(s) {
    r <- cds_isda(utils::modifyList(p, list(spreadBp = s)))
    data.frame(spread_bp = s, hazard = r$hazard, fair_upfront = r$isda$fair_upfront, npv = r$isda$npv)
  }))
  assign(key, out, envir = CDS_UPFRONT_CACHE)
  out
}

cds_compute <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  ranges <- list(spreadBp = c(1, 1000), couponBp = c(0, 1000), recoveryPct = c(0, 80), ratePct = c(-1, 20))
  read <- function(section) {
    given <- body[[section]]
    if (!is.null(given) && !is.list(given)) bad(sprintf("%s must be an object", section))
    unknown <- setdiff(names(given), names(ranges))
    if (length(unknown)) bad(sprintf("unknown field %s.%s", section, unknown[1]))
    p <- utils::modifyList(CDS_DEFAULTS[[section]], if (is.null(given)) list() else given)
    for (k in names(ranges)) {
      x <- p[[k]]
      if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= ranges[[k]][1] && x <= ranges[[k]][2])) {
        bad(sprintf("%s.%s must be within %s and %s", section, k, ranges[[k]][1], ranges[[k]][2]))
      }
    }
    p
  }
  flat <- read("flat"); isda <- read("isda")
  list(
    inputs = list(flat = flat, isda = isda),
    conventions = list(
      flat = "1年物：取引日 2022-09-19、Schedule 2022-09-20〜2023-09-20（3か月、週末のみ休日、Following、満期は調整なし、Forward）、Premium は Actual/360、QuantLib の CreditDefaultSwap と同じ組み方、MidPoint Engine",
      isda = "標準5年物：取引日 2022-08-19、満期は CDS2015 の IMM 日、QuantLib の MakeCreditDefaultSwap と同じ設定（Protection 開始と取引日は取引日、最終 Coupon は最終日も数える Actual/360）、ISDA Engine",
      curves = "割引：フラットな連続複利（Actual/365 Fixed）。Hazard：フラット（Actual/365 Fixed）。ゼロ NPV の Hazard Rate は uniroot（区間 1e-8〜0.5、tol 1e-10）",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))),
    flat = cds_flat(flat), sensitivity = cds_sensitivity(flat$ratePct / 100),
    isda = cds_isda(isda), upfront_by_spread = cds_upfront_by_spread(isda)
  )
}
