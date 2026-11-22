# Generate the expected values for Carmine Studio's API regression test from rmql (R, native build).
# This script is independent of server/R/tona_ois_model.R, so the test compares two code paths on the same engine.
#
#   "C:/Program Files/R/R-4.6.0/bin/Rscript.exe" C:/AnalyticFin/Projects/Carmine-Studio/server/tests/golden/generate_golden.R
#
# Writes server/tests/golden/tona_ois_golden.json (the expected values of the API regression test, tests/api.regression.test.ts). Numbers are written with 17 significant digits and the script checks
# that reading the file back gives the same doubles. rmql was reconciled with GaussQuant (QuantLib 1.42)
# under the same conditions in server/tests/reconciliation/RECONCILIATION.md.

suppressPackageStartupMessages({
  library(rmql)
  library(GaussQuant) # only for the sample quotes (bluegamma_tonar_quotes_GQL)
  library(jsonlite)
  library(dplyr)
  library(purrr)
})

root <- "C:/AnalyticFin/Projects/Carmine-Studio"
out_file <- file.path(root, "server/tests/golden/tona_ois_golden.json")
dir.create(dirname(out_file), showWarnings = FALSE, recursive = TRUE)

# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------

evaluation_date <- as.Date("2026-09-10")
notional <- 1e10
bump_quote_id <- "TONAR-5Y"
bump_size <- 1e-4
swap_years <- 7L
conventions <- list(
  index = "tonar", calendar = "japan", curve_day_count = "actual_365_fixed", settlement_days = 2L,
  payment_frequency = 1L, payment_lag = 0L, interpolation = "monotonic_log_cubic", accuracy = 1e-12,
  schedule_rule = "backward", schedule_convention = "modified_following",
  fixed_leg_day_count = "actual_365_fixed", side = "payer"
)

quotes <- GaussQuant::bluegamma_tonar_quotes_GQL() |>
  dplyr::filter(quote_id != "TONAR-7Y") |>
  dplyr::transmute(quote_id, tenor = paste0(tenor_n, ifelse(tenor_unit == "Years", "Y", "M")), rate)
stopifnot(nrow(quotes) == 13L)

cases <- list(
  base = quotes,
  bump_5y = dplyr::mutate(quotes, rate = ifelse(quote_id == bump_quote_id, rate + bump_size, rate))
)

build <- function(q) {
  instruments <- rmql::create_ois_instruments(
    q$tenor, q$rate, conventions$settlement_days, conventions$payment_frequency, conventions$payment_lag
  )
  rmql::bootstrap_ois_curve(
    evaluation_date, evaluation_date, conventions$index, conventions$curve_day_count, instruments,
    interpolation = conventions$interpolation, accuracy = conventions$accuracy
  )
}

# 7Y OIS dates with MakeOIS's rule, on rmql's calendar functions (as in the reconciliation)
spot <- rmql::compute_advanced_date("japan", rmql::compute_adjusted_date("japan", evaluation_date), "2D")
stopifnot(rmql::compute_end_of_month("japan", spot) != spot) # end-of-month start is not covered
termination <- seq(spot, by = paste(swap_years, "years"), length.out = 2L)[2L]

make_swap <- function(fixed_rate) {
  rmql::create_ois_swap("payer", notional, spot, termination, "tonar", fixed_rate,
                                  fixed_frequency = 1L, overnight_frequency = 1L, payment_lag = 0L)
}

# Fixed rate: the unrounded 7Y par rate of the base curve
base_curve <- build(cases$base)
fixed_rate <- rmql::compute_ois_swap_value(make_swap(0), base_curve, evaluation_date)$fair_rate

# Dates for discount factors and forwards: the monthly grid to 30Y, key anniversaries, pillars and their
# neighbours (where log-linear forwards step), and the swap's dates.
grid <- seq(evaluation_date, as.Date("2056-09-10"), by = "1 month")
key <- purrr::map_vec(c(1L, 2L, 3L, 4L, 5L, 7L, 10L, 15L, 20L, 30L), function(n) seq(evaluation_date, by = paste(n, "years"), length.out = 2L)[2L])

# ---------------------------------------------------------------------------
# Expected values per case
# ---------------------------------------------------------------------------

iso <- function(d) format(as.Date(d), "%Y-%m-%d")
# Continuously compounded zero rate (Actual/365 Fixed); undefined at the evaluation date, written as null.
zero_or_na <- function(curve, d) {
  if (as.Date(d) == evaluation_date) return(NA_real_)
  rmql::compute_zero_rate(curve, d, "actual_365_fixed", "continuous")
}

case_values <- purrr::imap(cases, function(q, case) {
  curve <- if (case == "base") base_curve else build(q)
  rep <- rmql::get_quote_repricing(curve)
  nodes <- rmql::get_discount_nodes(curve)
  pillars <- rep$pillar_date
  dates <- sort(unique(c(grid, key, pillars, pillars - 1L, pillars + 1L, spot, termination)))
  dates <- dates[dates + 1L <= max(pillars)] # no extrapolation: the 1-day forward must end on or before the last pillar
  swap <- make_swap(fixed_rate)
  value <- rmql::compute_ois_swap_value(swap, curve, evaluation_date)
  flows <- rmql::compute_ois_swap_cashflows(swap, curve, evaluation_date)
  stopifnot(all(is.na(flows$error)))
  list(
    quotes = lapply(seq_len(nrow(q)), function(i) list(quote_id = q$quote_id[i], tenor = q$tenor[i], rate = q$rate[i])),
    instruments = lapply(seq_len(nrow(rep)), function(i) list(
      tenor = rep$tenor[i], start_date = iso(rep$start_date[i]), maturity_date = iso(rep$maturity_date[i]),
      pillar_date = iso(rep$pillar_date[i]), implied_rate = rep$implied_rate[i]
    )),
    nodes = lapply(seq_len(nrow(nodes)), function(i) list(date = iso(nodes$date[i]), discount = nodes$discount[i],
                                                         zero_continuous = zero_or_na(curve, nodes$date[i]))),
    curve_points = lapply(seq_along(dates), function(i) list(
      date = iso(dates[i]),
      discount = rmql::compute_discount(curve, dates[i]),
      zero_continuous = zero_or_na(curve, dates[i]),
      forward_1d_simple = rmql::compute_forward_rate(curve, dates[i], dates[i] + 1L, "actual_365_fixed", "simple")
    )),
    swap = list(
      npv = value$npv, fixed_leg_npv = value$fixed_leg_npv, overnight_leg_npv = value$overnight_leg_npv,
      fixed_leg_bps = value$fixed_leg_bps, par_rate = value$fair_rate,
      cashflows = lapply(seq_len(nrow(flows)), function(i) list(
        leg = flows$leg[i], accrual_start = iso(flows$accrual_start[i]), accrual_end = iso(flows$accrual_end[i]),
        payment_date = iso(flows$payment_date[i]), amount = flows$amount[i]
      ))
    )
  )
})

golden <- list(
  meta = list(
    description = "Expected values for the JPY TONA OIS demo (13 quotes without 7Y, monotonic log-cubic discount, payment lag 0)",
    generated_at = format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z"),
    generator = "server/tests/golden/generate_golden.R",
    engine = paste("rmql", as.character(packageVersion("rmql")), "built", packageDescription("rmql")$Built),
    quote_source = "GaussQuant::bluegamma_tonar_quotes_GQL() without TONAR-7Y (sample data)",
    r_version = R.version.string
  ),
  evaluation_date = iso(evaluation_date),
  conventions = conventions,
  bump = list(quote_id = bump_quote_id, size = bump_size),
  swap_terms = list(
    tenor = paste0(swap_years, "Y"), side = "payer", notional = notional, fixed_rate = fixed_rate,
    effective_date = iso(spot), termination_date = iso(termination),
    fixed_rate_source = "unrounded 7Y par rate of the base curve (rmql compute_ois_swap_value()$fair_rate)"
  ),
  cases = case_values,
  pv_change = case_values$bump_5y$swap$npv - case_values$base$swap$npv
)

json <- jsonlite::toJSON(golden, auto_unbox = TRUE, digits = I(17), pretty = TRUE, na = "null")
writeLines(json, out_file, useBytes = TRUE)

# Round-trip check: every double read back is identical
back <- jsonlite::fromJSON(out_file, simplifyVector = FALSE)
stopifnot(identical(back$swap_terms$fixed_rate, fixed_rate))
stopifnot(identical(back$pv_change, golden$pv_change))
stopifnot(identical(
  purrr::map_dbl(back$cases$bump_5y$curve_points, "discount"),
  purrr::map_dbl(golden$cases$bump_5y$curve_points, "discount")
))
stopifnot(identical(
  purrr::map_dbl(back$cases$base$curve_points, "forward_1d_simple"),
  purrr::map_dbl(golden$cases$base$curve_points, "forward_1d_simple")
))

cat("wrote", out_file, "\n")
cat(sprintf("fixed rate %.17g\nbase PV %.17g\nbumped PV %.17g\nPV change %.17g\n", fixed_rate,
            case_values$base$swap$npv, case_values$bump_5y$swap$npv, golden$pv_change))
