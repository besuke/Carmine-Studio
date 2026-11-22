# 13.2: the binomial tree of a discretely monitored lookback option, against the closed form of the continuously monitored one
# (monitoring at every step: the error falls like one over the square root of the steps), and a monthly monitoring against an
# independent Monte Carlo (exact lognormal steps, antithetic pairs). Synthetic inputs: S = m = M = 100, r = 3%, q = 1%, 25%, one year.
#
#   Rscript server/scripts/p16/lookback_convergence.R

source(file.path("server", "scripts", "p16", "common.R"))
seed <- 20261122L
inputs <- list(spot = 100, rate = 0.03, dividend = 0.01, volatility = 0.25, time = 1)

continuous <- function(kind) compute_lookback_option_value("floating", kind, inputs$spot, inputs$spot, NA, inputs$rate, inputs$dividend, inputs$volatility, inputs$time)$value
tree <- function(kind, steps, monitoring) compute_discrete_lookback_option_value("floating", kind, inputs$spot, inputs$spot, NA, inputs$rate, inputs$dividend, inputs$volatility,
                                                                               inputs$time, monitoring_times = monitoring, steps = as.integer(steps))$value

steps <- c(100L, 200L, 400L, 800L, 1600L)
every_step <- lapply(c(call = "call", put = "put"), function(kind) {
  exact <- continuous(kind)
  values <- vapply(steps, \(n) tree(kind, n, (seq_len(n) / n) * inputs$time), 0)
  # in 1 / sqrt(steps): t(N) = V - c / sqrt(N), so V = 2 t(4N) - t(N)
  extrapolated <- vapply(c(1L, 2L), \(i) 2 * values[i + 2L] - values[i], 0)
  list(continuous = exact, steps = steps, tree = values, error = exact - values, error_times_sqrt_steps = (exact - values) * sqrt(steps),
       extrapolated_from = list(c(steps[1], steps[3]), c(steps[2], steps[4])), extrapolated = extrapolated, extrapolated_error = exact - extrapolated)
})

# A Monte Carlo of the floating-strike option monitored at `dates` equally spaced times.
monte_carlo <- function(kind, dates, pairs) {
  dt <- inputs$time / dates
  drift <- (inputs$rate - inputs$dividend - 0.5 * inputs$volatility^2) * dt
  sd <- inputs$volatility * sqrt(dt)
  z <- matrix(rnorm(pairs * dates), pairs, dates)
  payoff <- function(sign) {
    path <- inputs$spot * exp(t(apply(drift + sd * sign * z, 1, cumsum)))
    extremum <- if (kind == "call") pmin(inputs$spot, apply(path, 1, min)) else pmax(inputs$spot, apply(path, 1, max))
    if (kind == "call") path[, dates] - extremum else extremum - path[, dates]
  }
  v <- 0.5 * exp(-inputs$rate * inputs$time) * (payoff(1) + payoff(-1))
  c(value = mean(v), standard_error = sd(v) / sqrt(pairs))
}
set.seed(seed)
monthly <- lapply(c(call = "call", put = "put"), function(kind) {
  months <- (1:12) / 12 * inputs$time
  coarse <- tree(kind, 1200L, months); fine <- tree(kind, 2400L, months)
  extrapolated <- (sqrt(2) * fine - coarse) / (sqrt(2) - 1)
  mc <- monte_carlo(kind, 12L, 100000L)
  list(tree_1200 = coarse, tree_2400 = fine, extrapolated = extrapolated, monte_carlo = unname(mc["value"]), monte_carlo_standard_error = unname(mc["standard_error"]),
       monte_carlo_pairs = 100000L, difference_in_standard_errors = (extrapolated - mc[["value"]]) / mc[["standard_error"]])
})

p16_write("lookback_convergence.json", list(
  meta = p16_meta("server/scripts/p16/lookback_convergence.R", seed, "the extremum is the spot: a new option; discrete monitoring on a tree of CRR steps"),
  inputs = inputs, every_step = every_step, monthly = monthly
))
