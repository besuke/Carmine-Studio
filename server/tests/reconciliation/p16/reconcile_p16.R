# Reconcile chapter 13 (lookback options, convertible bonds, MSCB): the page's own model (server/R/lookback_model.R and
# convertible_model.R, which call rmql) against independent references: QuantLib 1.42 (continuously monitored lookback options,
# BinomialCRRConvertibleEngine), closed forms (Black-Scholes calls), an independent Monte Carlo, and the identities of the
# contracts (a conversion price that cannot change is a fixed ratio). All inputs are synthetic.
#
#   npm run reconcile:p16
#
# Writes server/tests/reconciliation/p16/results/*.csv and RECONCILIATION_P16.md, and stops with an error if a check fails.

suppressPackageStartupMessages({
  library(QuantLib)
  library(rmql)
  library(jsonlite)
})

lab <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_dir <- file.path(lab, "server/tests/reconciliation/p16")
res_dir <- file.path(out_dir, "results")
dir.create(res_dir, showWarnings = FALSE, recursive = TRUE)
script_dir <- file.path(lab, "server")
source(file.path(script_dir, "R", "lookback_model.R"))
source(file.path(script_dir, "R", "convertible_model.R"))
set.seed(20261123)

settle <- as.Date(P16_SETTLEMENT)
ql_today <- QuantLib::Date(as.integer(settle) + 25569L)   # QuantLib's serial numbers count days from 1899-12-30
invisible(QuantLib::Settings_instance()$setEvaluationDate(ql_today))
dc <- QuantLib::Actual365Fixed()
ql_date <- function(date) QuantLib::Date(as.integer(date) + 25569L)
process_of <- function(spot, rate, dividend, volatility) {
  QuantLib::BlackScholesMertonProcess(
    QuantLib::QuoteHandle(QuantLib::SimpleQuote(spot)),
    QuantLib::YieldTermStructureHandle(QuantLib::FlatForward(ql_today, dividend, dc)),
    QuantLib::YieldTermStructureHandle(QuantLib::FlatForward(ql_today, rate, dc)),
    QuantLib::BlackVolTermStructureHandle(QuantLib::BlackConstantVol(ql_today, QuantLib::NullCalendar(), volatility, dc))
  )
}
checks <- list()
record <- function(group, what, n, worst, tolerance, note = "") {
  checks[[length(checks) + 1L]] <<- data.frame(group = group, check = what, cases = n, worst = worst, tolerance = tolerance, passed = is.finite(worst) && worst <= tolerance, note = note)
}

# ---- 1. continuously monitored lookback options against QuantLib 1.42 -----------------------------------------------------
cases <- expand.grid(type = c("floating", "fixed"), kind = c("call", "put"), rates = 1:2, volatility = c(0.2, 0.4), days = c(180, 730), KEEP.OUT.ATTRS = FALSE, stringsAsFactors = FALSE)
cases$rate <- c(0.03, 0.05)[cases$rates]
cases$dividend <- c(0.01, 0.0499)[cases$rates]     # QuantLib returns NaN where r = q; rmql's value there is the limit (continuity checked in rmql)
lookback <- do.call(rbind, lapply(seq_len(nrow(cases)), function(i) {
  c <- cases[i, ]
  min_tracked <- (c$type == "floating" && c$kind == "call") || (c$type == "fixed" && c$kind == "put")
  spot <- 100
  extremum <- if (min_tracked) 85 else 115
  strike <- if (c$type == "fixed") c(95, 105)[1 + (i %% 2)] else NA_real_
  time <- c$days / 365
  api <- lookback_compute(list(lookbackType = c$type, optionType = c$kind, spot = spot, runningExtremum = extremum, strike = if (is.na(strike)) NULL else strike,
                               ratePct = 100 * c$rate, dividendYieldPct = 100 * c$dividend, volatilityPct = 100 * c$volatility, time = time, monitoringCount = 0))
  process <- process_of(spot, c$rate, c$dividend, c$volatility)
  exercise <- QuantLib::EuropeanExercise(ql_date(settle + c$days))
  if (c$type == "floating") {
    option <- QuantLib::ContinuousFloatingLookbackOption(extremum, QuantLib::FloatingTypePayoff(if (c$kind == "call") "Call" else "Put"), exercise)
    QuantLib::Instrument_setPricingEngine(option, QuantLib::AnalyticContinuousFloatingLookbackEngine(process))
  } else {
    option <- QuantLib::ContinuousFixedLookbackOption(extremum, QuantLib::PlainVanillaPayoff(if (c$kind == "call") "Call" else "Put", strike), exercise)
    QuantLib::Instrument_setPricingEngine(option, QuantLib::AnalyticContinuousFixedLookbackEngine(process))
  }
  expected <- QuantLib::Instrument_NPV(option)
  data.frame(lookback_type = c$type, option_type = c$kind, spot = spot, running_extremum = extremum, strike = strike, rate = c$rate, dividend = c$dividend,
             volatility = c$volatility, days = c$days, api_value = api$continuous$value, quantlib_value = expected, relative_difference = (api$continuous$value - expected) / expected)
}))
utils::write.csv(lookback, file.path(res_dir, "lookback_continuous_vs_quantlib.csv"), row.names = FALSE)
record("lookback", "continuous monitoring, the API against QuantLib 1.42 (floating and fixed, call and put)", nrow(lookback), max(abs(lookback$relative_difference)), 1e-9)

# a fixed strike is a floating strike plus a constant: the same inputs through both
fixed_call <- lookback_compute(list(lookbackType = "fixed", optionType = "call", spot = 100, runningExtremum = 100, strike = 90, monitoringCount = 0))$continuous$value
floating_put <- lookback_compute(list(lookbackType = "floating", optionType = "put", spot = 100, runningExtremum = 100, monitoringCount = 0))$continuous$value
identity <- abs(fixed_call - (floating_put + 100 * exp(-0.01) - 90 * exp(-0.03))) / fixed_call
record("lookback", "fixed-strike call = floating-strike put + S e^{-qT} - K e^{-rT}", 1L, identity, 1e-12)

# ---- 2. discretely monitored lookback options: convergence, and an independent Monte Carlo ----------------------------------
tree <- function(kind, steps, count) lookback_compute(list(lookbackType = "floating", optionType = kind, spot = 100, runningExtremum = 100, monitoringCount = count, steps = steps))
rows <- lapply(c("call", "put"), function(kind) {
  exact <- tree(kind, 400, 0)$continuous$value
  e <- vapply(c(100, 400), \(n) exact - tree(kind, n, n)$discrete$value, 0)
  extrapolated <- 2 * tree(kind, 400, 400)$discrete$value - tree(kind, 100, 100)$discrete$value
  data.frame(option_type = kind, error_100 = e[1], error_400 = e[2], ratio = e[2] / e[1], extrapolated_relative_error = (exact - extrapolated) / exact)
})
discrete <- do.call(rbind, rows)
utils::write.csv(discrete, file.path(res_dir, "lookback_discrete_convergence.csv"), row.names = FALSE)
record("lookback", "discrete monitoring at every step: the error halves when the steps are four times (ratio 0.5 +- 0.05)", 2L, max(abs(discrete$ratio - 0.5)), 0.05)
record("lookback", "discrete monitoring: the extrapolation in 1/sqrt(steps) against the closed form", 2L, max(abs(discrete$extrapolated_relative_error)), 5e-3)

monte_carlo <- function(kind, dates, pairs) {
  dt <- 1 / dates
  drift <- (0.03 - 0.01 - 0.5 * 0.25^2) * dt
  sd <- 0.25 * sqrt(dt)
  z <- matrix(rnorm(pairs * dates), pairs, dates)
  payoff <- function(sign) {
    path <- 100 * exp(t(apply(drift + sd * sign * z, 1, cumsum)))
    extremum <- if (kind == "call") pmin(100, apply(path, 1, min)) else pmax(100, apply(path, 1, max))
    if (kind == "call") path[, dates] - extremum else extremum - path[, dates]
  }
  v <- 0.5 * exp(-0.03) * (payoff(1) + payoff(-1))
  c(value = mean(v), se = sd(v) / sqrt(pairs))
}
mc <- do.call(rbind, lapply(c("call", "put"), function(kind) {
  # steps that are multiples of 12 put the monitoring dates on the lattice (396 = 33 x 12 is the largest below the limit of 400);
  # the extrapolation in 1 / sqrt(steps) uses 132 and 396
  fine <- tree(kind, 396, 12)$discrete$value
  coarse <- tree(kind, 132, 12)$discrete$value
  extrapolated <- (sqrt(3) * fine - coarse) / (sqrt(3) - 1)
  m <- monte_carlo(kind, 12L, 60000L)
  data.frame(option_type = kind, tree_extrapolated = extrapolated, monte_carlo = m[["value"]], standard_error = m[["se"]], difference = extrapolated - m[["value"]], difference_in_standard_errors = (extrapolated - m[["value"]]) / m[["se"]])
}))
utils::write.csv(mc, file.path(res_dir, "lookback_monthly_vs_monte_carlo.csv"), row.names = FALSE)
record("lookback", "monthly monitoring: the tree (extrapolated from 132 and 396 steps) against an independent Monte Carlo, in price units (60,000 antithetic pairs)", 2L, max(abs(mc$difference)), 0.1,
       sprintf("the standard error of the Monte Carlo is %.3f", max(mc$standard_error)))

# ---- 3. convertible bonds against QuantLib 1.42 (BinomialCRRConvertibleEngine) -------------------------------------------
n <- 24L
convertible_rows <- list()
tries <- 0L
while (length(convertible_rows) < n && tries < 500L) {
  tries <- tries + 1L
  years <- sample(c(2L, 3L, 5L), 1)
  exercise <- sample(c("european", "american", "bermudan"), 1)
  half <- seq(0.5, years, by = 0.5)
  steps <- sample(c(100L, 150L, 200L, 250L, 300L), 1)
  # QuantLib's time grid can end an ulp below the end and then not allow an American conversion at maturity (see rmql's specification, 4)
  end <- as.numeric(p16_date(years) - settle) / 365
  if (exercise == "american" && end > (end / steps) * steps) next
  calls <- NULL
  k <- sample(0:2, 1)
  if (k > 0) calls <- data.frame(years = sort(sample(half, k)), kind = sample(c("call", "put"), k, replace = TRUE), price = round(runif(k, 98, 125), 2), priceType = sample(c("clean", "dirty"), k, replace = TRUE))
  body <- list(bond = list(remainingYears = years, couponPct = round(runif(1, 0, 5), 3), redemption = 100),
               conversion = list(kind = "fixed", ratio = round(runif(1, 0.5, 1.5), 4)), exercise = exercise,
               exerciseYears = if (exercise == "bermudan") sort(sample(half, min(3, length(half)))) else NULL,
               callabilities = calls,
               market = list(spot = round(runif(1, 60, 130), 2), ratePct = round(runif(1, 0, 5), 3), dividendYieldPct = round(runif(1, 0, 3), 3),
                             volatilityPct = round(runif(1, 15, 40), 2), creditSpreadPct = round(runif(1, 0, 4), 3)), steps = steps)
  api <- convertible_compute(body)
  m <- body$market
  maturity <- p16_date(years)
  sched <- QuantLib::Schedule(ql_today, ql_date(maturity), QuantLib::Period(6L, "Months"), QuantLib::TARGET(), "Unadjusted", "Unadjusted", "Backward", FALSE)
  ql_exercise <- switch(exercise, european = QuantLib::EuropeanExercise(ql_date(maturity)), american = QuantLib::AmericanExercise(ql_today, ql_date(maturity)),
                        bermudan = { dv <- QuantLib::DateVector(); for (y in body$exerciseYears) QuantLib::DateVector_push_back(dv, ql_date(p16_date(y))); QuantLib::BermudanExercise(dv) })
  ql_calls <- QuantLib::CallabilitySchedule()
  plain <- QuantLib::ConvertibleFixedCouponBond(ql_exercise, body$conversion$ratio, QuantLib::CallabilitySchedule(), ql_today, 0L, c(body$bond$couponPct / 100), dc, sched, 100)
  if (!is.null(calls)) for (j in seq_len(nrow(calls))) {
    date <- ql_date(p16_date(calls$years[j]))
    QuantLib::CallabilitySchedule_push_back(ql_calls, QuantLib::Callability(QuantLib::BondPrice(calls$price[j], if (calls$priceType[j] == "clean") "Clean" else "Dirty"), if (calls$kind[j] == "call") "Call" else "Put", date))
  }
  bond <- QuantLib::ConvertibleFixedCouponBond(ql_exercise, body$conversion$ratio, ql_calls, ql_today, 0L, c(body$bond$couponPct / 100), dc, sched, 100)
  QuantLib::Instrument_setPricingEngine(bond, QuantLib::BinomialCRRConvertibleEngine(process_of(m$spot, m$ratePct / 100, m$dividendYieldPct / 100, m$volatilityPct / 100), steps,
                                                                                    QuantLib::QuoteHandle(QuantLib::SimpleQuote(m$creditSpreadPct / 100)), QuantLib::DividendSchedule()))
  expected <- QuantLib::Instrument_NPV(bond)
  convertible_rows[[length(convertible_rows) + 1L]] <- data.frame(exercise = exercise, years = years, steps = steps, calls = if (is.null(calls)) 0L else nrow(calls),
                                                                   api_value = api$values$value, quantlib_value = expected, relative_difference = (api$values$value - expected) / expected)
}
convertible <- do.call(rbind, convertible_rows)
utils::write.csv(convertible, file.path(res_dir, "convertible_vs_quantlib.csv"), row.names = FALSE)
record("convertible", "the API against QuantLib 1.42 BinomialCRRConvertibleEngine (European, American, Bermudan; calls, puts, clean prices)", nrow(convertible), max(abs(convertible$relative_difference)), 1e-9,
       "the cases where QuantLib's time grid ends below the end are left out (rmql's specification, 4)")

# ---- 4. the contracts' identities and closed forms (the API against rmql's own limits and the closed forms) ---------------------
zero <- function(...) list(bond = list(remainingYears = 2, couponPct = 0, redemption = 100), market = list(spot = 100, ratePct = 3, dividendYieldPct = 1, volatilityPct = 25, creditSpreadPct = 0), exercise = "european", ...)
time2 <- as.numeric(p16_date(2) - settle) / 365
unit_call <- function(spot, strike, time) rmql::compute_european_option_value("call", spot, strike, 0.03, 0.01, 0.25, time)$value
# the straight bond and a call: F e^{-rT} + ratio call(S, F / ratio)
b <- convertible_compute(c(zero(steps = 300L), list(conversion = list(kind = "fixed", ratio = 0.9))))$values$value
fixed_expected <- 100 * exp(-0.03 * time2) + 0.9 * unit_call(100, 100 / 0.9, time2)
record("convertible", "European conversion without coupon or credit spread = F e^{-rT} + ratio call(S, F / ratio) (300 steps)", 1L, abs(b - fixed_expected) / fixed_expected, 3e-3, "the error of a tree of 300 steps")
# a reset price with equal limits is a fixed ratio
fixed100 <- convertible_compute(list(conversion = list(kind = "fixed", ratio = 100 / 95), steps = 250L))$values$value
equal <- vapply(c(0.5, 0.9, 1.3), \(a) convertible_compute(list(conversion = list(kind = "reset", priceRatio = a, lowerPrice = 95, upperPrice = 95), steps = 250L))$values$value, 0)
record("mscb", "a conversion price reset between equal limits = a fixed ratio F / K", 3L, max(abs(equal - fixed100) / fixed100), 1e-10)
# the closed form of a European reset (13.4), through the API at 300 steps
reset_closed <- function(alpha, lower, upper) {
  third <- if (is.finite(upper)) unit_call(100, upper / alpha, time2) / upper else 0
  100 * exp(-0.03 * time2) + 100 * (unit_call(100, lower, time2) / lower - unit_call(100, lower / alpha, time2) / lower + third)
}
rc <- do.call(rbind, lapply(list(c(0.9, 80, 140), c(0.8, 90, 110), c(0.95, 70, Inf)), function(p) {
  v <- convertible_compute(c(zero(steps = 300L), list(conversion = list(kind = "reset", priceRatio = p[1], lowerPrice = p[2], upperPrice = if (is.finite(p[3])) p[3] else NULL))))$values$value
  data.frame(alpha = p[1], lower = p[2], upper = p[3], api_value = v, closed_form = reset_closed(p[1], p[2], p[3]), relative_difference = (v - reset_closed(p[1], p[2], p[3])) / reset_closed(p[1], p[2], p[3]))
}))
utils::write.csv(rc, file.path(res_dir, "mscb_reset_closed_form.csv"), row.names = FALSE)
record("mscb", "a conversion price reset at conversion: the closed form of the European case (300 steps)", nrow(rc), max(abs(rc$relative_difference)), 3e-3, "the error of a tree of 300 steps")
imm <- convertible_compute(list(conversion = list(kind = "reset", priceRatio = 0.9, lowerPrice = 80), market = list(spot = 100), steps = 200L))
record("mscb", "above lower / ratio an American holder converts at once for F / ratio", 1L, abs(imm$values$value - 100 / 0.9) / (100 / 0.9), 1e-9, if (imm$immediate_conversion) "flagged by the API" else "NOT flagged")

# carried between resets
mscb <- function(...) mscb_compute(list(...))
no_reset <- vapply(c("scaled", "grid"), \(m) mscb(conversion = list(initialPrice = 100, priceRatio = 0.9), method = m, greeks = FALSE, steps = 200L, market = list(spot = 92))$values$value, 0)
fixed_equivalent <- convertible_compute(list(conversion = list(kind = "fixed", ratio = 1), market = list(spot = 92), steps = 200L))$values$value
record("mscb", "a conversion price carried with no reset date = a fixed ratio (scaled lattice and grid)", 2L, max(abs(no_reset - fixed_equivalent) / fixed_equivalent), 1e-10)
tau <- as.numeric(p16_date(1) - settle) / 365
both_closed <- 100 * exp(-0.03 * time2) + exp(-0.03 * tau) * (100 / 0.9) * unit_call(1, 0.9, time2 - tau)
both <- function(method, steps, nodes = 40) mscb(bond = list(remainingYears = 2, couponPct = 0, redemption = 100), exercise = "european", conversion = list(initialPrice = 100, priceRatio = 0.9),
                                                 market = list(spot = 100, creditSpreadPct = 0), resetYears = 1, rule = "both", method = method, priceNodes = nodes, greeks = FALSE, steps = steps)$values$value
sc <- both("scaled", 400L); gr <- both("grid", 400L, 80L)
record("mscb", "rule both, one reset, European conversion: the closed form F e^{-rT} + e^{-r tau} (F / alpha) call(1, alpha, T - tau) (400 steps; the grid with 80 prices)", 2L, max(abs(c(sc, gr) - both_closed) / both_closed), 3e-3, "the error of a tree of 400 steps")
sc_dw <- mscb(conversion = list(initialPrice = 100, priceRatio = 0.9), resetYears = 1:4, market = list(spot = 85), method = "scaled", steps = 300L)$values$value
gr_dw <- mscb(conversion = list(initialPrice = 100, priceRatio = 0.9), resetYears = 1:4, market = list(spot = 85), method = "grid", priceNodes = 80, greeks = FALSE, steps = 300L)$values$value
record("mscb", "downward_only, four resets, American: the grid of 80 prices against the scaled lattice", 1L, abs(gr_dw - sc_dw) / sc_dw, 2e-3, "the two interpolations differ; see rmql's specification, 6")

# ---- the record ------------------------------------------------------------------------------------------------------------------
summary <- do.call(rbind, checks)
utils::write.csv(summary, file.path(res_dir, "summary.csv"), row.names = FALSE)
lines <- c(
  "# Reconciliation of chapter 13 (lookback options, convertible bonds, MSCB)",
  "",
  sprintf("Run %s with rmql %s and QuantLib %s (R package). Synthetic inputs. `npm run reconcile:p16`; the tables are in `results/`.",
          format(Sys.time(), "%Y-%m-%d"), as.character(packageVersion("rmql")), as.character(packageVersion("QuantLib"))),
  "",
  "| Group | Check | Cases | Largest difference | Tolerance | Result | Note |",
  "|---|---|---:|---:|---:|---|---|",
  sprintf("| %s | %s | %d | %.3g | %.3g | %s | %s |", summary$group, summary$check, summary$cases, summary$worst, summary$tolerance, ifelse(summary$passed, "pass", "FAIL"), summary$note),
  "",
  "The model of the page is `server/R/lookback_model.R` and `convertible_model.R` (the API functions are called as the server calls them); the reference of each check is in its name.",
  "QuantLib's convertible engine does not allow an American conversion at maturity for the numbers of steps at which its time grid ends one unit in the last place below the end; rmql does, and those cases are left out (rmql's `docs/spec_lookback_convertible.md`, 4)."
)
writeLines(lines, file.path(out_dir, "RECONCILIATION_P16.md"), useBytes = TRUE)
print(summary[, c("group", "cases", "worst", "tolerance", "passed")], row.names = FALSE)
if (!all(summary$passed)) stop("some checks of chapter 13 failed: ", paste(summary$check[!summary$passed], collapse = "; "))
cat("all", nrow(summary), "checks passed\n")
