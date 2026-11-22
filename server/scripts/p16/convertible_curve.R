# 13.3: the value of a convertible bond and its delta along the share price, with and without a call; the conversion value and
# the value of the straight bond (a conversion ratio that is nearly 0) for comparison. Synthetic inputs: five-year semiannual 2%
# bond, American conversion, ratio 1.0, credit spread 2%, r = 3%, q = 1%, volatility 25%, 100 steps.
#
#   Rscript server/scripts/p16/convertible_curve.R

source(file.path("server", "scripts", "p16", "common.R"))
bond <- p16_bond(5, 0.02)
exercise <- c(p16_settlement, format(p16_years_to_date(5)))
spots <- seq(40, 160, by = 5)
call <- data.frame(date = p16_years_to_date(3), kind = "call", price = 108)
value <- function(ratio, calls) compute_convertible_bond_value(bond, p16_settlement, "american", exercise, ratio, spots, 0.03, 0.01, 0.25, 0.02, 100L, calls)

plain <- value(1.0, NULL)
with_call <- value(1.0, call)
straight <- value(1e-9, NULL)
p16_write("convertible_curve.json", list(
  meta = p16_meta("server/scripts/p16/convertible_curve.R", NA_integer_, "deterministic; no random numbers"),
  inputs = list(remaining_years = 5, coupon_pct = 2, conversion_ratio = 1, credit_spread_pct = 2, rate_pct = 3, dividend_yield_pct = 1, volatility_pct = 25, steps = 100,
                call = list(years = 3, price = 108, price_type = "dirty")),
  spots = spots,
  conversion_value = 1.0 * spots,
  straight_bond = straight$value,
  convertible = list(value = plain$value, delta = plain$delta, gamma = plain$gamma),
  convertible_with_call = list(value = with_call$value, delta = with_call$delta, gamma = with_call$gamma)
))
