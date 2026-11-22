# Interest-rate models (Coral-Book II-7). The manuscript draws its random numbers with R (set.seed, rnorm); the
# same numbers are used here and passed to rmql where it takes normals (caplet, correlated shocks). The
# Hull-White paths are the manuscript's exact OU transition in R, next to rmql's monthly Hull-White rates
# (its own random numbers). Reconciled with the manuscript's code and its own results in server/tests/reconciliation/rate_models/.
#
# POST /api/rate-models
#   {"hw":      {"ratePct": 2, "aPct": 12, "sigmaPct": 1},
#    "caplet":  {"forwardPct": 2.5, "strikePct": 2.75, "volPct": 24, "expiry": 2, "accrual": 0.5, "ratePct": 2},
#    "shocks":  {"ab": 0.8, "ac": 0.5, "bc": 0.7},
#    "fixings": {"basePct": 1, "amplitudePct": 0.4, "days": 90}}
# Every field is optional; the defaults are the manuscript's illustrative values.

RM_DEFAULTS <- list(
  hw = list(ratePct = 2, aPct = 12, sigmaPct = 1),
  caplet = list(forwardPct = 2.5, strikePct = 2.75, volPct = 24, expiry = 2, accrual = 0.5, ratePct = 2),
  shocks = list(ab = 0.8, ac = 0.5, bc = 0.7),
  fixings = list(basePct = 1, amplitudePct = 0.4, days = 90)
)
RM_SEEDS <- list(hw = 617L, caplet = 618L, shocks = 619L)

rm_memo_env <- new.env(parent = emptyenv())
rm_memo <- function(name, inputs, f) {
  key <- paste(name, paste(format(unlist(inputs), digits = 17), collapse = "|"))
  if (is.null(rm_memo_env[[key]])) assign(key, f(), envir = rm_memo_env)
  rm_memo_env[[key]]
}
# R's normals with a seed, leaving the session's random state as it was
rm_rnorm <- function(n, seed) {
  old <- if (exists(".Random.seed", envir = globalenv())) get(".Random.seed", envir = globalenv()) else NULL
  on.exit(if (is.null(old)) rm(".Random.seed", envir = globalenv()) else assign(".Random.seed", old, envir = globalenv()))
  set.seed(seed)
  stats::rnorm(n)
}

# II-7.2: Hull-White on a flat continuous curve. r_t = phi(t) + x_t, x an OU process with the exact transition.
rm_hw_shift <- function(time, flat_rate, a, sigma) flat_rate + sigma^2 / (2 * a^2) * (1 - exp(-a * time))^2
rm_hw_paths <- function(flat_rate, a, sigma, horizon = 5, steps_per_year = 24L, paths = 8000L, seed = RM_SEEDS$hw) {
  n <- as.integer(horizon * steps_per_year)
  h <- horizon / n
  times <- seq(0, horizon, length.out = n + 1L)
  shocks <- matrix(rm_rnorm(paths * n, seed), nrow = paths)
  decay <- exp(-a * h)
  scale <- sigma * sqrt(-expm1(-2 * a * h) / (2 * a))
  states <- do.call(cbind, purrr::accumulate(seq_len(n), .init = rep(0, paths), .f = \(prev, k) decay * prev + scale * shocks[, k]))
  list(times = times, rates = sweep(states, 2, rm_hw_shift(times, flat_rate, a, sigma), "+"), step = h)
}
rm_discount_check <- function(discounts, maturities, flat_rate, label) {
  data.frame(model = label, maturity = maturities, initial_curve = exp(-flat_rate * maturities),
             simulation = colMeans(discounts), mc_standard_error = apply(discounts, 2, stats::sd) / sqrt(nrow(discounts))) |>
    transform(difference = simulation - initial_curve)
}
rm_hw <- function(p) rm_memo("hw", p, function() {
  r <- p$ratePct / 100; a <- p$aPct / 100; sigma <- p$sigmaPct / 100
  sim <- rm_hw_paths(r, a, sigma)
  maturities <- c(1, 2, 5)
  # left-end sums of the rates, as the manuscript
  cum <- t(apply(sim$rates[, -ncol(sim$rates), drop = FALSE] * sim$step, 1, cumsum))
  manuscript <- rm_discount_check(exp(-cum[, as.integer(round(maturities / sim$step)), drop = FALSE]), maturities, r, "原稿の手順（R、半月刻み、seed 617）")
  monthly <- rmql::generate_hull_white_monthly_rates(8000L, 60L, r, a, sigma, seed = RM_SEEDS$hw)
  monthly_cum <- t(apply(monthly / 12, 1, cumsum))
  rmql <- rm_discount_check(exp(-monthly_cum[, maturities * 12L, drop = FALSE]), maturities, r, "rmql（月次、antithetic）")
  q <- apply(sim$rates, 2, stats::quantile, probs = c(0.05, 0.5, 0.95))
  list(
    flat_rate = r, a = a, sigma = sigma, steps_per_year = 24L, paths = nrow(sim$rates), seed = RM_SEEDS$hw,
    times = sim$times, sample_paths = lapply(1:8, \(i) sim$rates[i, ]),
    mean_path = colMeans(sim$rates), quantile_05 = q[1, ], quantile_95 = q[3, ],
    shift = rm_hw_shift(sim$times, r, a, sigma),
    rmql_sample_paths = lapply(1:8, \(i) c(NA, monthly[i, ])), rmql_times = (0:60) / 12,
    discount_check = rbind(manuscript, rmql),
    # II-7.3: the forward-rate loading of one-factor Hull-White, sigma exp(-a (T - t))
    hjm_loading = data.frame(time_to_maturity = seq(0, 15, by = 0.1), forward_volatility = sigma * exp(-a * seq(0, 15, by = 0.1)))
  )
})

# II-7.4.2: a caplet by Black's formula and by the marginal distribution of its forward rate, from R's normals.
rm_caplet <- function(p) rm_memo("caplet", p, function() {
  F <- p$forwardPct / 100; K <- p$strikePct / 100; v <- p$volPct / 100; T <- p$expiry; tau <- p$accrual
  df <- exp(-p$ratePct / 100 * (T + tau))
  z <- rm_rnorm(50000L, RM_SEEDS$caplet)
  black <- rmql::compute_caplet_value(F, K, v, T, tau, df)
  mc <- rmql::compute_caplet_from_normals(z, F, K, v, T, tau, df)
  terminal <- F * exp(-v^2 * T / 2 + v * sqrt(T) * z)
  hist <- ggplot2::layer_data(ggplot2::ggplot(data.frame(x = 100 * terminal), ggplot2::aes(x = x)) + ggplot2::geom_histogram(bins = 40))
  backward <- rmql::compute_backward_caplet_value(F, K, v, T, T + tau, tau, df)
  list(
    forward = F, strike = K, volatility = v, expiry = T, accrual = tau, discount_factor = df, paths = length(z), seed = RM_SEEDS$caplet,
    black_price = black, simulated_price = mc$value, mc_standard_error = mc$standard_error,
    in_the_money = mean(terminal > K), terminal_mean = mean(terminal),
    terminal_histogram = data.frame(xmin = hist$xmin, xmax = hist$xmax, x = hist$x, count = hist$count),
    backward_price = backward
  )
})

# II-7.4.3: correlated shocks from R's independent normals and the Cholesky factor of the target.
rm_shocks <- function(p) rm_memo("shocks", p, function() {
  target <- matrix(c(1, p$ab, p$ac, p$ab, 1, p$bc, p$ac, p$bc, 1), 3, byrow = TRUE)
  independent <- matrix(rm_rnorm(90000L, RM_SEEDS$shocks), ncol = 3)
  correlated <- rmql::compute_correlated_normals(independent, target)
  sample <- stats::cor(correlated)
  names3 <- c("A", "B", "C")
  grid <- expand.grid(forward_1 = names3, forward_2 = names3, stringsAsFactors = FALSE)
  grid$target <- target[cbind(match(grid$forward_1, names3), match(grid$forward_2, names3))]
  grid$simulated <- sample[cbind(match(grid$forward_1, names3), match(grid$forward_2, names3))]
  list(paths = nrow(independent), seed = RM_SEEDS$shocks, table = grid,
       eigenvalues = eigen(target, symmetric = TRUE, only.values = TRUE)$values,
       scatter = data.frame(a = correlated[1:400, 1], b = correlated[1:400, 2], c = correlated[1:400, 3]))
})

# II-7.5: compounding of fictitious daily overnight fixings, and the rate realized so far.
rm_fixings <- function(p) {
  n <- as.integer(p$days)
  obs <- seq_len(n)
  rate <- p$basePct / 100 + p$amplitudePct / 100 * sin(2 * pi * obs / n)
  frac <- rep(1 / 365, n)
  factor <- cumprod(1 + frac * rate)
  elapsed <- cumsum(frac)
  list(days = n, compounded_rate = (prod(1 + frac * rate) - 1) / sum(frac), simple_average = mean(rate),
       daily = data.frame(observation = obs, overnight_rate = rate, realized_factor = factor, realized_rate_to_date = (factor - 1) / elapsed))
}

rate_models_compute <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  ranges <- list(
    hw = list(ratePct = c(-2, 15), aPct = c(0.5, 100), sigmaPct = c(0.01, 5)),
    caplet = list(forwardPct = c(0.01, 20), strikePct = c(0.01, 20), volPct = c(1, 200), expiry = c(0.1, 30), accrual = c(0.05, 2), ratePct = c(-2, 15)),
    shocks = list(ab = c(-0.99, 0.99), ac = c(-0.99, 0.99), bc = c(-0.99, 0.99)),
    fixings = list(basePct = c(-2, 15), amplitudePct = c(0, 5), days = c(5, 400))
  )
  read <- function(section) {
    given <- body[[section]]
    if (!is.null(given) && !is.list(given)) bad(sprintf("%s must be an object", section))
    unknown <- setdiff(names(given), names(RM_DEFAULTS[[section]]))
    if (length(unknown)) bad(sprintf("unknown field %s.%s", section, unknown[1]))
    p <- utils::modifyList(RM_DEFAULTS[[section]], if (is.null(given)) list() else given)
    for (k in names(ranges[[section]])) {
      x <- p[[k]]; lim <- ranges[[section]][[k]]
      if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= lim[1] && x <= lim[2])) bad(sprintf("%s.%s must be within %s and %s", section, k, lim[1], lim[2]))
    }
    p
  }
  hw <- read("hw"); cap <- read("caplet"); sh <- read("shocks"); fx <- read("fixings")
  target <- matrix(c(1, sh$ab, sh$ac, sh$ab, 1, sh$bc, sh$ac, sh$bc, 1), 3, byrow = TRUE)
  if (min(eigen(target, symmetric = TRUE, only.values = TRUE)$values) <= 1e-10) bad("相関行列が正定値になりません（ρ(A,B)・ρ(A,C)・ρ(B,C) の組み合わせを見直してください）")
  list(
    inputs = list(hw = hw, caplet = cap, shocks = sh, fixings = fx),
    conventions = list(
      hw = "フラットな連続複利の初期曲線。原稿の手順は OU 状態の厳密な遷移（半月刻み、5年、8000本、R の seed 617）、割引は左端の値の和。rmql は月次の短期金利（antithetic、パッケージの乱数）",
      caplet = "割引係数 exp(−r (T + τ))。モンテカルロは R の seed 618 の 50000 個の正規乱数を rmql に渡す。後決めキャップレットは rmql（期間中にボラが減衰）",
      shocks = "R の seed 619 の独立な正規乱数（30000 × 3）に、目標相関のコレスキー因子を掛ける（rmql compute_correlated_normals）",
      fixings = "架空の翌日物金利（水準 ＋ 振幅 × sin）、各日 1/365",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))),
    hw = rm_hw(hw), caplet = rm_caplet(cap), shocks = rm_shocks(sh), fixings = rm_fixings(fx)
  )
}
