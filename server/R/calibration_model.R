# Calibration of interest-rate derivatives (Coral-Book II-6). The model prices and volatilities are rmql.
# The manuscript's own fitting procedure (R's optim, L-BFGS-B, its starts, bounds and objectives) is run on the
# rmql functions, next to rmql's own calibrators. Reconciled with GaussQuant running the
# manuscript's code, and with the manuscript's own results, in server/tests/reconciliation/calibration/.
#
# POST /api/calibration
#   {"normal": {"forwardPct": 0.56, "blackVolPct": 40, "normalVolBp": 40, "expiry": 2},
#    "sabr":   {"beta": 0.5},
#    "hw":     {"aPct": 8, "sigmaPct": 1.2, "zeroPct": 3},
#    "bgm":    {"decay": 0.45}}
# Every field is optional; the defaults are the manuscript's illustrative values.

CAL_DEFAULTS <- list(
  normal = list(forwardPct = 0.56, blackVolPct = 40, normalVolBp = 40, expiry = 2),
  sabr = list(beta = 0.5),
  hw = list(aPct = 8, sigmaPct = 1.2, zeroPct = 3),
  bgm = list(decay = 0.45)
)
CAL_SABR <- list(
  strike_pct = c(0.06, 0.31, 0.56, 0.81, 1.06, 1.56, 2.56),
  black_vol_pct = c(90.78, 46.09, 45.30, 50.17, 53.85, 58.42, 62.72),
  forward = 0.0056, expiry = 2
)
CAL_HW <- data.frame(option_maturity = c(0.5, 1, 2, 3), bond_maturity = c(2, 3, 5, 7),
                     strike_multiplier = c(0.99, 1, 1.01, 1), sample = c("fit", "fit", "fit", "validation"))
CAL_BGM <- list(tenor = 1:4, caplet_vol = c(0.24, 0.22, 0.21, 0.20), weights = c(0.28, 0.26, 0.24, 0.22))
CAL_CURVE_DATE <- "2026-11-02" # any date: the bond options are on times in years from the curve's reference date

cal_memo_env <- new.env(parent = emptyenv())
cal_memo <- function(name, inputs, f) {
  key <- paste(name, paste(format(unlist(inputs), digits = 17), collapse = "|"))
  if (is.null(cal_memo_env[[key]])) assign(key, f(), envir = cal_memo_env)
  cal_memo_env[[key]]
}

# II-6.2: a call priced with a normal (Bachelier) and a lognormal (Black) volatility, across strikes. Black needs a
# positive strike; the normal model is defined for any strike.
cal_normal <- function(p) {
  F <- p$forwardPct / 100; T <- p$expiry
  strikes <- seq(-1, 2.5, by = 0.05) / 100
  normal <- rmql::compute_forward_option_value("bachelier", "call", F, strikes, p$normalVolBp / 1e4, T, 1)$value
  # Black needs a positive forward and a positive strike; otherwise it has no value (NA, null in JSON)
  positive <- strikes > 0 & F > 0
  black <- rep(NA_real_, length(strikes))
  if (any(positive)) {
    black[positive] <- rmql::compute_forward_option_value("black", "call", F, strikes[positive], p$blackVolPct / 100, T, 1)$value
  }
  atm <- list(
    normal = rmql::compute_forward_option_value("bachelier", "call", F, F, p$normalVolBp / 1e4, T, 1)$value,
    black = if (F > 0) rmql::compute_forward_option_value("black", "call", F, F, p$blackVolPct / 100, T, 1)$value else NA_real_
  )
  list(forward = F, expiry = T, black_volatility = p$blackVolPct / 100, normal_volatility = p$normalVolBp / 1e4,
       by_strike = data.frame(strike = strikes, normal = normal, black = black), atm = atm,
       # at the money, sigma_N ~ sigma_B * F: the normal volatility that gives Black's at-the-money price
       atm_normal_equivalent_bp = 1e4 * p$blackVolPct / 100 * F)
}

# II-6.3: the smile. The manuscript's procedure (optim, L-BFGS-B, start 0.1, bounds) on rmql's lognormal
# SABR volatility, and rmql's calibrate_sabr (Levenberg-Marquardt), with beta fixed.
cal_sabr <- function(p) cal_memo("sabr", p, function() {
  s <- CAL_SABR
  K <- s$strike_pct / 100; V <- s$black_vol_pct / 100; beta <- p$beta
  vol <- function(k, par) rmql::compute_sabr_volatility("lognormal", k, s$forward, s$expiry, par[["alpha"]], beta, par[["nu"]], par[["rho"]])
  objective <- function(par) {
    m <- tryCatch(vol(K, c(alpha = par[[1]], nu = par[[2]], rho = par[[3]])), error = function(e) rep(NA_real_, length(K)))
    if (any(!is.finite(m))) return(1e6)
    mean((m - V)^2)
  }
  o <- stats::optim(c(alpha = 0.1, volvol = 0.1, rho = 0.1), objective, method = "L-BFGS-B",
                    lower = c(1e-4, 0, -0.999), upper = c(1, 5, 0.999), control = list(maxit = 1000))
  manuscript <- c(alpha = o$par[[1]], nu = o$par[[2]], rho = o$par[[3]])
  lm <- rmql::calibrate_sabr("lognormal", K, V, s$forward, s$expiry, beta)
  rmql <- c(alpha = lm$alpha, nu = lm$nu, rho = lm$rho)
  grid <- seq(0.02, 3, by = 0.02) / 100
  list(
    forward = s$forward, expiry = s$expiry, beta = beta,
    quotes = data.frame(strike = K, market = V, manuscript_fit = vol(K, manuscript), rmql_fit = vol(K, rmql)),
    fits = data.frame(method = c("原稿の手順（optim, L-BFGS-B）", "rmql：calibrate_sabr（Levenberg–Marquardt）"),
                      alpha = c(manuscript[["alpha"]], rmql[["alpha"]]), nu = c(manuscript[["nu"]], rmql[["nu"]]),
                      rho = c(manuscript[["rho"]], rmql[["rho"]]),
                      rmse = c(sqrt(o$value), lm$root_mean_square_error), iterations = c(o$counts[["function"]], lm$iterations),
                      convergence = c(o$convergence, 0L)),
    smile = data.frame(strike = grid, manuscript_fit = vol(grid, manuscript), rmql_fit = vol(grid, rmql))
  )
})

# II-6.4: Hull-White bond options. The "market" prices come from a reference (a, sigma) on a flat continuous zero
# curve; three fit, one is left for validation. The manuscript's optim and rmql's calibrate_hull_white.
cal_hw <- function(p) cal_memo("hw", p, function() {
  r <- p$zeroPct / 100
  curve <- rmql::create_flat_curve(CAL_CURVE_DATE, r, "actual_365_fixed", "continuous")
  m <- CAL_HW
  m$strike <- exp(-r * (m$bond_maturity - m$option_maturity)) * m$strike_multiplier
  price <- function(a, sigma, rows = seq_len(nrow(m))) {
    rmql::compute_hull_white_bond_option_value("call", m$strike[rows], m$option_maturity[rows], m$bond_maturity[rows], a, sigma, curve)
  }
  m$market_price <- price(p$aPct / 100, p$sigmaPct / 100)
  fit_rows <- which(m$sample == "fit")
  objective <- function(par) sum((1e4 * (price(par[[1]], par[[2]], fit_rows) - m$market_price[fit_rows]))^2)
  o <- stats::optim(c(a = 0.05, sigma = 0.01), objective, method = "L-BFGS-B", lower = c(0.001, 0.0001), upper = c(1, 0.1),
                    control = list(maxit = 1000, factr = 1e3))
  lm <- rmql::calibrate_hull_white(curve, bond_options = data.frame(
    option_type = "call", strike = m$strike[fit_rows], maturity = m$option_maturity[fit_rows], bond_maturity = m$bond_maturity[fit_rows],
    price = m$market_price[fit_rows], weight = 1e8))
  m$manuscript_price <- price(o$par[[1]], o$par[[2]])
  m$rmql_price <- price(lm$mean_reversion, lm$volatility)
  list(
    zero_rate = r, reference = list(a = p$aPct / 100, sigma = p$sigmaPct / 100),
    options = m,
    fits = data.frame(method = c("原稿の手順（optim, L-BFGS-B）", "rmql：calibrate_hull_white"),
                      a = c(o$par[[1]], lm$mean_reversion), sigma = c(o$par[[2]], lm$volatility),
                      objective = c(o$value, objective(c(lm$mean_reversion, lm$volatility))),
                      evaluations = c(o$counts[["function"]], NA), convergence = c(o$convergence, 0L)),
    # the objective along a with sigma at each a re-fitted is costly; this is the slice at the reference sigma
    objective_slice = data.frame(a = seq(0.01, 0.2, by = 0.005)) |>
      transform(objective = vapply(seq(0.01, 0.2, by = 0.005), function(a) objective(c(a, p$sigmaPct / 100)), 0))
  )
})

# II-6.5: the manuscript's fixed-weight proxy of a swaption volatility from caplet volatilities and an exponential
# correlation exp(-decay |Ti - Tj|), and the decay recovered from it; next to it (an addition of this page) Rebonato's
# approximation in rmql's lognormal forward market model with the same caplet volatilities.
cal_bgm_proxy <- function(decay) {
  b <- CAL_BGM
  correlation <- exp(-decay * abs(outer(b$tenor, b$tenor, "-")))
  wv <- b$weights * b$caplet_vol
  sqrt(as.numeric(t(wv) %*% correlation %*% wv))
}
CAL_LMM_FORWARD <- 0.03 # the manuscript gives no forwards; Rebonato's weights depend on them (an assumption here)
cal_lmm <- function(decay) {
  rmql::create_lmm(times = c(1, 2, 3, 4, 5), forwards = rep(CAL_LMM_FORWARD, 4), volatilities = CAL_BGM$caplet_vol, beta = decay)
}
cal_bgm <- function(p) cal_memo("bgm", p, function() {
  target <- cal_bgm_proxy(p$decay)
  fit <- stats::optimize(function(d) (cal_bgm_proxy(d) - target)^2, interval = c(0.01, 2))
  rebonato <- function(d) rmql::compute_rebonato_swaption_volatility(cal_lmm(d), 1L, 5L)
  rebonato_target <- rebonato(p$decay)
  rebonato_fit <- rmql::calibrate_lmm_correlation(cal_lmm(1), 1L, 5L, rebonato_target)
  decays <- seq(0.01, 2, by = 0.01)
  list(
    tenor = CAL_BGM$tenor, caplet_vol = CAL_BGM$caplet_vol, weights = CAL_BGM$weights, decay = p$decay,
    proxy_vol = target, fitted_decay = fit$minimum, lmm_forward = CAL_LMM_FORWARD,
    rebonato_vol = rebonato_target, rebonato_fitted_decay = as.numeric(rebonato_fit$beta[[1]]),
    by_decay = data.frame(decay = decays, proxy = vapply(decays, cal_bgm_proxy, 0), rebonato = vapply(decays, rebonato, 0))
  )
})

calibration_compute <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  ranges <- list(
    normal = list(forwardPct = c(-1, 5), blackVolPct = c(1, 200), normalVolBp = c(1, 500), expiry = c(0.1, 30)),
    sabr = list(beta = c(0, 1)),
    hw = list(aPct = c(0.5, 50), sigmaPct = c(0.05, 5), zeroPct = c(-1, 10)),
    bgm = list(decay = c(0.02, 1.9))
  )
  read <- function(section) {
    given <- body[[section]]
    if (!is.null(given) && !is.list(given)) bad(sprintf("%s must be an object", section))
    unknown <- setdiff(names(given), names(CAL_DEFAULTS[[section]]))
    if (length(unknown)) bad(sprintf("unknown field %s.%s", section, unknown[1]))
    p <- utils::modifyList(CAL_DEFAULTS[[section]], if (is.null(given)) list() else given)
    for (k in names(ranges[[section]])) {
      x <- p[[k]]; lim <- ranges[[section]][[k]]
      if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= lim[1] && x <= lim[2])) bad(sprintf("%s.%s must be within %s and %s", section, k, lim[1], lim[2]))
    }
    p
  }
  n <- read("normal"); s <- read("sabr"); h <- read("hw"); b <- read("bgm")
  list(
    inputs = list(normal = n, sabr = s, hw = h, bgm = b),
    conventions = list(
      normal = "割引係数 1（原稿の単位の説明と同じく、割引を除いた価格）。Black 型は行使金利が正のときだけ定義される",
      sabr = "説明用の7点（単一満期2年、フォワード 0.56%）。Hagan の対数正規近似。β は固定し、α・ν・ρ を推定",
      hw = "フラットな連続複利ゼロカーブ。「市場価格」は基準の a・σ で作った説明用の値（原稿と同じ）。3本で推定し、1本を検証に残す",
      bgm = "原稿の固定ウェイト近似（説明用）。Rebonato の近似は rmql の対数正規フォワード・マーケット・モデル（フォワード 3% は仮定）",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))),
    normal = cal_normal(n), sabr = cal_sabr(s), hw = cal_hw(h), bgm = cal_bgm(b)
  )
}
