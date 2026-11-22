# 13.5: a conversion price carried between reset dates. (1) the grid of conversion prices against the scaled lattice (no limits on
# the price) for 20 to 160 prices; (2) the closed form of the rule `both` with one reset and a European conversion, for the scaled lattice and
# the grid; (3) the times of the scaled lattice and of the grid, with and without the Greeks, on this machine; (4) the Greeks of a grid,
# which the live API does not give. Synthetic inputs: American, five-year 2% bond, a call at 108 after three years, resets each year
# (rule downward_only, ratio 0.9, initial price 100), S = 85, credit spread 2%, r = 3%, q = 1%, volatility 25%.
#
#   Rscript server/scripts/p16/mscb_carried_grid.R

source(file.path("server", "scripts", "p16", "common.R"))
market <- list(spot = 85, rate = 0.03, dividend = 0.01, volatility = 0.25, spread = 0.02)
bond <- p16_bond(5, 0.02)
exercise <- c(p16_settlement, format(p16_years_to_date(5)))
calls <- data.frame(date = p16_years_to_date(3), kind = "call", price = 108)
resets <- vapply(1:4, \(y) as.numeric(p16_years_to_date(y)), 0) |> as.Date(origin = "1970-01-01")
run <- function(method, steps, nodes = 40L, greeks = TRUE, spot = market$spot, reset = resets, calls_ = calls) {
  compute_carried_reset_convertible_bond_value(bond, p16_settlement, "american", exercise, reset, "downward_only", 0.9, 100, spot = spot, rate = market$rate, dividend_yield = market$dividend,
                                               volatility = market$volatility, credit_spread = market$spread, steps = as.integer(steps), method = method, price_nodes = as.integer(nodes),
                                               greeks = greeks, callabilities = calls_)
}

# (1) convergence of the grid to the scaled lattice
steps <- 300L
scaled <- run("scaled", steps)$value
nodes <- c(20L, 40L, 80L, 160L)
grid <- vapply(nodes, \(n) run("grid", steps, n, greeks = FALSE)$value, 0)
convergence <- list(steps = steps, scaled = scaled, price_nodes = nodes, grid = grid, relative_difference = (grid - scaled) / scaled)

# (2) the rule `both`, one reset after one year, European conversion at maturity, zero-coupon bond, no spread (the closed form of 13.4's family)
zero <- p16_bond(2, 0)
zero_maturity <- p16_years_to_date(2)
time <- as.numeric(zero_maturity - as.Date(p16_settlement)) / 365
tau <- as.numeric(p16_years_to_date(1) - as.Date(p16_settlement)) / 365
alpha <- 0.9
unit_call <- compute_european_option_value("call", 1, alpha, market$rate, market$dividend, market$volatility, time - tau)$value
exact <- 100 * exp(-market$rate * time) + exp(-market$rate * tau) * (100 / alpha) * unit_call
both <- function(method, steps, nodes = 40L) compute_carried_reset_convertible_bond_value(zero, p16_settlement, "european", format(zero_maturity), p16_years_to_date(1), "both", alpha, 100, spot = 100,
                                                                                         rate = market$rate, dividend_yield = market$dividend, volatility = market$volatility, credit_spread = 0,
                                                                                         steps = as.integer(steps), method = method, price_nodes = as.integer(nodes), greeks = FALSE)$value
closed_form <- list(closed_form = exact, scaled_steps = 2000L, scaled = both("scaled", 2000L), grid_steps = 400L, grid_price_nodes = 120L, grid = both("grid", 400L, 120L))
closed_form$scaled_relative_error <- (closed_form$scaled - exact) / exact
closed_form$grid_relative_error <- (closed_form$grid - exact) / exact

# (3) the times (seconds, the shortest of three runs; of this machine on the day)
timing <- do.call(rbind, lapply(expand.grid(steps = c(200L, 400L), greeks = c(FALSE, TRUE)) |> split(seq(4)), function(g) {
  data.frame(steps = g$steps, greeks = g$greeks, scaled_seconds = p16_time(\() run("scaled", g$steps, greeks = g$greeks)),
             grid_40_seconds = p16_time(\() run("grid", g$steps, 40L, greeks = g$greeks), reps = 1L), grid_80_seconds = p16_time(\() run("grid", g$steps, 80L, greeks = g$greeks), reps = 1L))
}))

# (4) the Greeks of a grid (40 prices, 200 steps) and of the scaled lattice
g_grid <- run("grid", 200L, 40L, greeks = TRUE)
g_scaled <- run("scaled", 200L, greeks = TRUE)
greeks <- list(steps = 200L, price_nodes = 40L,
               grid = as.list(g_grid[c("value", "delta", "gamma", "vega", "rho", "dividend_rho", "credit_spread_sensitivity")]),
               scaled = as.list(g_scaled[c("value", "delta", "gamma", "vega", "rho", "dividend_rho", "credit_spread_sensitivity")]))

p16_write("mscb_carried_grid.json", list(
  meta = p16_meta("server/scripts/p16/mscb_carried_grid.R", NA_integer_, "deterministic; the times are of this machine on the day"),
  inputs = list(market = market, reset_years = 1:4, rule = "downward_only", price_ratio = 0.9, initial_price = 100, call = list(years = 3, price = 108)),
  convergence = convergence, closed_form_both = closed_form,
  timing = lapply(seq_len(nrow(timing)), \(i) as.list(timing[i, ])), greeks = greeks
))
