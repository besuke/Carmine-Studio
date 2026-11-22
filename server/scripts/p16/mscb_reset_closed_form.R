# 13.4: a conversion price reset at conversion. A European conversion of a zero-coupon bond, with no credit spread and no call, has a
# closed form in Black-Scholes calls: the conversion value of a bond of face F is F g(S), g = max(S / upper, min(S / lower, 1 / ratio)),
# g = S / lower - (S / lower - 1 / ratio)+ + (S / upper - 1 / ratio)+ for lower <= upper and ratio <= 1, so that
#   V = F e^{-rT} + F [call(lower) / lower - call(lower / ratio) / lower + call(upper / ratio) / upper].
# The lattice of rmql against it for several steps. And the property of a price ratio below 1: above lower / ratio an American
# holder converts at once for F / ratio, whatever the share price. Synthetic inputs: r = 3%, q = 1%, volatility 25%, S = 100.
#
#   Rscript server/scripts/p16/mscb_reset_closed_form.R

source(file.path("server", "scripts", "p16", "common.R"))
market <- list(spot = 100, rate = 0.03, dividend = 0.01, volatility = 0.25)
zero <- p16_bond(2, 0)
settle <- as.Date(p16_settlement)
maturity <- p16_years_to_date(2)
time <- as.numeric(maturity - settle) / 365
call <- function(strike) compute_european_option_value("call", market$spot, strike, market$rate, market$dividend, market$volatility, time)$value
closed_form <- function(alpha, lower, upper) {
  third <- if (is.finite(upper)) call(upper / alpha) / upper else 0
  100 * exp(-market$rate * time) + 100 * (call(lower) / lower - call(lower / alpha) / lower + third)
}

steps <- c(500L, 1000L, 2000L)
cases <- expand.grid(alpha = c(0.8, 0.9, 0.95), lower = c(70, 80), upper = c(140, Inf), KEEP.OUT.ATTRS = FALSE)
cases <- cases[cases$upper >= cases$lower, ]
table <- do.call(rbind, lapply(seq_len(nrow(cases)), function(i) {
  c <- cases[i, ]
  expected <- closed_form(c$alpha, c$lower, c$upper)
  values <- vapply(steps, \(n) compute_reset_convertible_bond_value(zero, p16_settlement, "european", format(maturity), c$alpha, c$lower, c$upper, market$spot, market$rate,
                                                                    market$dividend, market$volatility, 0, n)$value, 0)
  data.frame(alpha = c$alpha, lower_price = c$lower, upper_price = if (is.finite(c$upper)) c$upper else NA_real_, closed_form = expected,
             steps = I(list(steps)), lattice = I(list(values)), relative_error = I(list((values - expected) / expected)))
}))

# the immediate conversion: American, five-year 2% bond, ratio 0.9, lower 80, no upper price
bond <- p16_bond(5, 0.02)
exercise <- c(p16_settlement, format(p16_years_to_date(5)))
spots <- c(60, 70, 80, 85, 88, 89, 90, 100, 120)
immediate <- compute_reset_convertible_bond_value(bond, p16_settlement, "american", exercise, 0.9, 80, Inf, spots, market$rate, market$dividend, market$volatility, 0.02, 200L)

p16_write("mscb_reset_closed_form.json", list(
  meta = p16_meta("server/scripts/p16/mscb_reset_closed_form.R", NA_integer_, "deterministic; no random numbers"),
  market = market, maturity_years = time, face = 100,
  closed_form_table = lapply(seq_len(nrow(table)), \(i) list(alpha = table$alpha[i], lower_price = table$lower_price[i], upper_price = table$upper_price[i],
                                                           closed_form = table$closed_form[i], steps = steps, lattice = table$lattice[[i]], relative_error = table$relative_error[[i]])),
  immediate_conversion = list(price_ratio = 0.9, lower_price = 80, face_over_ratio = 100 / 0.9, spots = spots, value = immediate$value, threshold_spot = 80 / 0.9)
))
