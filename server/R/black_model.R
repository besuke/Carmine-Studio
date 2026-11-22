# Black model (Coral-Book II-4). All calculations are rmql; reconciled with GaussQuant running the
# manuscript's code, and with the manuscript's own results, in server/tests/reconciliation/black/.
#
# POST /api/black
#   {"black": {"forward": 107.2109375, "strike": 107.5, "volPct": 5.2, "ratePct": 5},
#    "mc":    {"sequence": "pseudo", "paths": 200},
#    "bsm":   {"spot": 100, "strike": 100, "volPct": 20, "ratePct": 5, "dividendPct": 0},
#    "lsm":   {"paths": 2048}}
# Every field is optional; the defaults are the manuscript's examples (illustrative values, not market data).
#
# Black 76: trade 2023-07-21, expiry 2023-08-26 (36 days, Actual/365 Fixed). As in the manuscript, the Black process
# is a Black-Scholes process whose spot is the forward and whose dividend yield equals the rate.
# BSM: trade 2024-03-01, expiry 2025-03-03 (TARGET, one year; 367 days).
# Monte Carlo paths are rmql's. Its Sobol paths are QuantLib's (difference 0); its pseudo-random numbers are
# not QuantLib's Mersenne Twister, so a pseudo-random estimate differs from the manuscript's by sampling error.

BLACK_DATES <- list(trade = "2023-07-21", expiry = "2023-08-26")
BSM_DATES <- list(trade = "2024-03-01", expiry = "2025-03-03")
BLACK_T <- as.numeric(as.Date(BLACK_DATES$expiry) - as.Date(BLACK_DATES$trade)) / 365
BSM_T <- as.numeric(as.Date(BSM_DATES$expiry) - as.Date(BSM_DATES$trade)) / 365
BLACK_DEFAULTS <- list(
  black = list(forward = 107 + 6.75 / 32, strike = 107.5, volPct = 5.2, ratePct = 5),
  mc = list(sequence = "pseudo", paths = 200),
  bsm = list(spot = 100, strike = 100, volPct = 20, ratePct = 5, dividendPct = 0),
  lsm = list(paths = 2048)
)
MC_STEPS <- 12L

# Results that depend only on some inputs are kept per input (caches of pure functions), so that moving one input
# does not recompute the trees and the convergence tables of the others.
BLACK_CACHE <- new.env(parent = emptyenv())
blk_memo <- function(name, inputs, f) {
  key <- paste(name, paste(format(unlist(inputs), digits = 17), collapse = "|"))
  if (is.null(BLACK_CACHE[[key]])) assign(key, f(), envir = BLACK_CACHE)
  BLACK_CACHE[[key]]
}

blk_df <- function(x) as.data.frame(x)[, setdiff(names(x), "error"), drop = FALSE]

# II-4.2: the Black formula (BlackCalculator) and the analytic engine on the Black process.
blk_black <- function(p) {
  F <- p$forward; K <- p$strike; vol <- p$volPct / 100; r <- p$ratePct / 100
  disc <- exp(-r * BLACK_T)
  formula <- as.list(blk_df(rmql::compute_forward_option_value("black", "call", F, K, vol, BLACK_T, disc)))
  process <- as.list(blk_df(rmql::compute_european_option_value("call", F, K, r, r, vol, BLACK_T)))
  grid <- seq(round(F) - 8, round(F) + 8, by = 0.5)
  by_forward <- blk_df(rmql::compute_forward_option_value("black", "call", grid, K, vol, BLACK_T, disc))
  list(
    trade_date = BLACK_DATES$trade, expiry_date = BLACK_DATES$expiry, time = BLACK_T, discount = disc,
    forward = F, strike = K, volatility = vol, rate = r, std_dev = vol * sqrt(BLACK_T),
    formula = formula, process = c(process, list(theta_per_day = process$theta / 365)),
    implied_volatility = rmql::compute_implied_volatility("call", process$value, F, K, r, r, BLACK_T),
    by_forward = data.frame(forward = grid, value = by_forward$value, delta = by_forward$delta_forward,
                            intrinsic = disc * pmax(grid - K, 0))
  )
}

# Terminal payoff of the paths, discounted (GaussQuant terminal_option_mc_GQL).
blk_terminal_mc <- function(paths, K, disc) {
  last <- paths$price[paths$step == max(paths$step)]
  pv <- disc * pmax(last - K, 0)
  list(npv = mean(pv), standard_error = stats::sd(pv) / sqrt(length(pv)))
}
blk_paths <- function(p, sequence, n, steps = MC_STEPS) {
  r <- p$ratePct / 100
  rmql::generate_black_scholes_paths(p$forward, r, r, p$volPct / 100, BLACK_T, steps, n, sequence = sequence, seed = 1)
}

# II-4.4: Monte Carlo of the Black 76 call, the paths, the terminal distribution and the one-path check.
blk_mc <- function(p, m, analytic) {
  disc <- exp(-p$ratePct / 100 * BLACK_T)
  est <- blk_terminal_mc(blk_paths(p, m$sequence, m$paths), p$strike, disc)
  conv <- blk_memo("mc-convergence", p, function() do.call(rbind, lapply(c("pseudo", "sobol"), function(s) do.call(rbind, lapply(c(250, 500, 1000, 2000, 5000, 10000, 20000), function(n) {
    e <- blk_terminal_mc(blk_paths(p, s, n), p$strike, disc)
    data.frame(sequence = s, paths = n, npv = e$npv, standard_error = e$standard_error)
  })))))
  shown <- blk_paths(p, m$sequence, 120)
  terminal <- shown$price[shown$step == MC_STEPS]
  # the bins of the manuscript's figure: ggplot2::geom_histogram(bins = 24), read back with layer_data
  hist <- ggplot2::layer_data(ggplot2::ggplot(data.frame(price = terminal), ggplot2::aes(x = price)) + ggplot2::geom_histogram(bins = 24))
  # II-4.4.3, with Sobol numbers: the path from F exp(-sigma^2 dt / 2 + sigma sqrt(dt) Z), Z the inverse normal of
  # the Sobol point (the first point is 0.5 in every dimension, so paths 2 to 4 are shown).
  vol <- p$volPct / 100
  check_paths <- blk_paths(p, "sobol", 4, steps = 3L)
  z <- stats::qnorm(rmql::generate_sobol_sequence(3, 4))
  dt <- BLACK_T / 3
  one_path <- do.call(rbind, lapply(2:4, function(i) {
    gen <- check_paths$price[check_paths$path_id == i]
    hand <- p$forward * c(1, cumprod(exp(-0.5 * vol^2 * dt + vol * sqrt(dt) * z[i, ])))
    data.frame(path_id = i, step = 0:3, time = (0:3) * dt, z = c(NA, z[i, ]), generated_price = gen, hand_price = hand, difference = gen - hand)
  }))
  list(
    sequence = m$sequence, paths = m$paths, steps = MC_STEPS, seed = 1, npv = est$npv, standard_error = est$standard_error,
    analytic = analytic, difference = est$npv - analytic, convergence = conv,
    shown_paths = data.frame(path_id = shown$path_id, step = shown$step, time = shown$time, price = shown$price),
    terminal_prices = terminal, terminal_histogram = data.frame(xmin = hist$xmin, xmax = hist$xmax, x = hist$x, count = hist$count),
    one_path = one_path
  )
}

# II-4.3 and II-4.5: the European put (analytic and CRR) and the American put (CRR and approximations).
blk_bsm <- function(p) {
  S <- p$spot; K <- p$strike; vol <- p$volPct / 100; r <- p$ratePct / 100; q <- p$dividendPct / 100
  eu <- as.list(blk_df(rmql::compute_european_option_value("put", S, K, r, q, vol, BSM_T)))
  tree <- function(ex, steps) rmql::compute_binomial_option_value("put", ex, S, K, r, q, vol, BSM_T, steps)$value
  eu_tbl <- data.frame(method = c("crr_25", "analytic", "crr_100", "crr_500"),
                       npv = c(tree("european", 25L), eu$value, tree("european", 100L), tree("european", 500L)))
  eu_tbl$difference_from_analytic <- eu_tbl$npv - eu$value
  approx <- rmql::compute_american_approximation_value(c("barone_adesi_whaley", "bjerksund_stensland"), "put", S, K, r, q, vol, BSM_T)$value
  am500 <- tree("american", 500L)
  am_tbl <- data.frame(method = c("crr_25", "barone_adesi_whaley", "bjerksund_stensland", "crr_500"),
                       npv = c(tree("american", 25L), approx, am500))
  am_tbl$difference_from_crr_500 <- am_tbl$npv - am500
  steps <- c(10:100, 150L, 200L, 300L, 400L, 500L)
  conv <- rmql::compute_binomial_option_value("put", rep(c("european", "american"), each = length(steps)), S, K, r, q, vol, BSM_T, c(steps, steps))
  list(
    trade_date = BSM_DATES$trade, expiry_date = BSM_DATES$expiry, time = BSM_T, spot = S, strike = K, volatility = vol, rate = r, dividend = q,
    european = eu, european_engines = eu_tbl, american_engines = am_tbl, early_exercise_premium = am500 - eu$value,
    tree_convergence = data.frame(steps = steps, european = conv$value[seq_along(steps)], american = conv$value[length(steps) + seq_along(steps)])
  )
}

# II-4.6: Sobol paths and Longstaff-Schwartz under the manuscript's conditions (quadratic basis without the payoff,
# the same paths for the regression and the valuation, hold when fewer than 3 paths are in the money).
blk_lsm <- function(b, l, crr500) {
  vol <- b$volPct / 100; r <- b$ratePct / 100; q <- b$dividendPct / 100
  shown <- rmql::generate_black_scholes_paths(b$spot, r, q, vol, BSM_T, MC_STEPS, 64)
  v <- rmql::compute_longstaff_schwartz_value("put", b$spot, b$strike, r, q, vol, BSM_T, MC_STEPS, l$paths)
  ex <- v$exercise[[1]]
  # as the manuscript's table: the paths that never exercise are counted at maturity with those that pay there
  ex$paths_in_table <- ex$paths + ifelse(ex$step == MC_STEPS, v$unexercised_paths, 0L)
  reg <- as.data.frame(v$regressions[[1]])
  reg$coefficients <- NULL
  list(
    paths = l$paths, steps = MC_STEPS, value = v$value, standard_error = v$standard_error, european_value = v$european_value,
    exercise_probability = v$exercise_probability, unexercised_paths = v$unexercised_paths, crr_500 = crr500,
    difference_from_crr_500 = v$value - crr500, exercise = as.data.frame(ex), regressions = reg,
    shown_paths = data.frame(path_id = shown$path_id, step = shown$step, time = shown$time, price = shown$price),
    first_paths_sum = sum(shown$price)
  )
}

black_compute <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  ranges <- list(
    black = list(forward = c(1, 1000), strike = c(1, 1000), volPct = c(0.1, 200), ratePct = c(-5, 30)),
    mc = list(paths = c(10, 50000)),
    bsm = list(spot = c(1, 1000), strike = c(1, 1000), volPct = c(1, 200), ratePct = c(-5, 30), dividendPct = c(-5, 30)),
    lsm = list(paths = c(64, 16384))
  )
  read <- function(section) {
    given <- body[[section]]
    if (!is.null(given) && !is.list(given)) bad(sprintf("%s must be an object", section))
    unknown <- setdiff(names(given), names(BLACK_DEFAULTS[[section]]))
    if (length(unknown)) bad(sprintf("unknown field %s.%s", section, unknown[1]))
    p <- utils::modifyList(BLACK_DEFAULTS[[section]], if (is.null(given)) list() else given)
    for (k in names(ranges[[section]])) {
      x <- p[[k]]; lim <- ranges[[section]][[k]]
      if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= lim[1] && x <= lim[2])) bad(sprintf("%s.%s must be within %s and %s", section, k, lim[1], lim[2]))
    }
    p
  }
  b76 <- read("black"); m <- read("mc"); b <- read("bsm"); l <- read("lsm")
  if (!(is.character(m$sequence) && length(m$sequence) == 1L && m$sequence %in% c("pseudo", "sobol"))) bad("mc.sequence must be \"pseudo\" or \"sobol\"")
  m$paths <- as.integer(round(m$paths)); l$paths <- as.integer(round(l$paths))
  black <- blk_black(b76)
  bsm <- blk_memo("bsm", b, function() blk_bsm(b))
  lsm <- blk_memo("lsm", c(b, l), function() blk_lsm(b, l, bsm$american_engines$npv[bsm$american_engines$method == "crr_500"]))
  list(
    inputs = list(black = b76, mc = m, bsm = b, lsm = l),
    conventions = list(
      black = "Black 76：取引日 2023-07-21、満期 2023-08-26（36日、Actual/365 Fixed）、割引は連続複利。Black process は「現物＝フォワード、配当利回り＝金利」の BSM process（原稿と同じ）",
      bsm = "BSM：取引日 2024-03-01、満期 2025-03-03（TARGET で1年、367日）、金利・配当利回りは連続複利",
      mc = "パスは rmql の generate_black_scholes_paths（12ステップ、厳密な対数正規の推移）。Sobol は QuantLib と同じ点列（差 0）。疑似乱数は QuantLib の Mersenne Twister と異なるため、原稿の値とは標本誤差の範囲で異なる",
      lsm = "Longstaff–Schwartz は原稿の条件：基底 1・S・S²（Payoff なし）、回帰と評価に同じ Sobol パス、ITM のパスが3本未満の日は継続",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))),
    black = black, mc = blk_mc(b76, m, black$formula$value), bsm = bsm, lsm = lsm
  )
}
