# Early redemption models (Coral-Book II-8). The callable bond and the mortgage pool are rmql, and so are the
# issuer's exercise decisions (II-8.4.3: compute_hull_white_callable_bond_decisions, from rmql 0.3.5; reconciled with the
# manuscript's decisions in rmql's tests, and here in server/tests/reconciliation/callable/). The 20 Hull-White
# paths of II-8.8 are the manuscript's (R's set.seed 48, antithetic) and are valued with rmql.
#
# POST /api/callable
#   {"bond": {"ratePct": 2, "aPct": 15, "sigmaPct": 1.2, "couponPct": 3, "firstCallYear": 1, "callPrice": 100},
#    "mbs":  {"psaPct": 100, "incentive": 20, "refiCostPct": 0.5}}
# Every field is optional; the defaults are the manuscript's illustrative values.

CB_DEFAULTS <- list(
  bond = list(ratePct = 2, aPct = 15, sigmaPct = 1.2, couponPct = 3, firstCallYear = 1, callPrice = 100),
  mbs = list(psaPct = 100, incentive = 20, refiCostPct = 0.5)
)
CB_CURVE_DATE <- "2026-11-02" # any date: the bond's times are in years from the curve's reference date
CB_MBS <- list(balance = 100, mortgage_rate = 0.05, pass_through_rate = 0.045, months = 360L, seed = 48L, paths = 20L,
               own_paths = 2000L, own_seed = 48L)

cb_memo_env <- new.env(parent = emptyenv())
cb_memo <- function(name, inputs, f) {
  key <- paste(name, paste(format(unlist(inputs), digits = 17), collapse = "|"))
  if (is.null(cb_memo_env[[key]])) assign(key, f(), envir = cb_memo_env)
  cb_memo_env[[key]]
}

# ---- II-8.4.3: the issuer's decisions, from rmql (the same grid and quadrature as the price) -------------------
cb_decisions <- function(flows, a, sigma, curve, points = 321L, limit = 0.13, nodes = 24L) {
  rmql::compute_hull_white_callable_bond_decisions(flows$time, flows$coupon, flows$principal, flows$call_price,
                                                              a, sigma, curve, points = points, limit = limit, nodes = nodes)
}

# ---- II-8.1–8.6: the callable bond ----------------------------------------------------------------------------------
cb_flows <- function(p) {
  time <- seq(0.5, 5, by = 0.5)
  data.frame(time = time, coupon = 100 * p$couponPct / 100 * 0.5, principal = ifelse(time == 5, 100, 0),
             call_price = ifelse(time >= p$firstCallYear & time < 5, p$callPrice, NA_real_))
}
cb_value <- function(flows, r, a, sigma, curve, points = 321L, nodes = 24L) {
  as.list(rmql::compute_hull_white_callable_bond_value(flows$time, flows$coupon, flows$principal, flows$call_price,
                                                                 a, sigma, curve, points = points, limit = 0.13, nodes = nodes))
}
cb_bond <- function(p) cb_memo("bond", p, function() {
  r <- p$ratePct / 100; a <- p$aPct / 100; sigma <- p$sigmaPct / 100
  curve <- rmql::create_flat_curve(CB_CURVE_DATE, r, "actual_365_fixed", "continuous")
  flows <- cb_flows(p)
  v <- cb_value(flows, r, a, sigma, curve)
  bullet_curve <- sum((flows$coupon + flows$principal) * exp(-r * flows$time))
  vols <- c(0, 0.006, 0.012, 0.020)
  by_vol <- data.frame(volatility = vols) |>
    transform(callable = vapply(vols, \(s) cb_value(flows, r, a, s, curve)$callable, 0),
              issuer_call_value = vapply(vols, \(s) cb_value(flows, r, a, s, curve)$issuer_call_value, 0))
  vol_grid <- seq(0, 0.025, by = 0.001)
  curve_by_vol <- data.frame(volatility = vol_grid, issuer_call_value = vapply(vol_grid, \(s) cb_value(flows, r, a, s, curve)$issuer_call_value, 0))
  grids <- data.frame(points = c(161L, 321L, 641L), nodes = c(16L, 24L, 32L))
  grids$callable <- mapply(\(pt, nd) cb_value(flows, r, a, sigma, curve, pt, nd)$callable, grids$points, grids$nodes)
  grids$bullet_grid_error <- mapply(\(pt, nd) cb_value(flows, r, a, sigma, curve, pt, nd)$bullet, grids$points, grids$nodes) - bullet_curve
  grids$change_from_previous <- c(NA, diff(grids$callable))
  dc <- cb_decisions(flows, a, sigma, curve)
  dec <- dc$decisions
  # the highest short rate at which the issuer calls, on each call date (calls when rates are low)
  boundary <- as.data.frame(dc$boundary)
  at2 <- dec[abs(dec$payment_time - 2) < 1e-10 & dec$short_rate >= -0.02 & dec$short_rate <= 0.08, ]
  list(
    flows = flows, rate = r, a = a, sigma = sigma,
    bullet_from_curve = bullet_curve, bullet = v$bullet, callable = v$callable, issuer_call_value = v$issuer_call_value,
    by_volatility = by_vol, curve_by_volatility = curve_by_vol, grid_convergence = grids,
    exercise_boundary = boundary, decision_year2 = at2[, c("short_rate", "continuation_ex_coupon", "call_price", "exercise_now")]
  )
})

# ---- II-8.8: the mortgage pool --------------------------------------------------------------------------------------
cb_hw_monthly_manuscript <- function(paths = 20L, months = 360L, r = 0.02, a = 0.15, sigma = 0.012, seed = 48L) {
  old <- if (exists(".Random.seed", envir = globalenv())) get(".Random.seed", envir = globalenv()) else NULL
  on.exit(if (is.null(old)) rm(".Random.seed", envir = globalenv()) else assign(".Random.seed", old, envir = globalenv()))
  set.seed(seed)
  dt <- 1 / 12; b <- exp(-a * dt); sd <- sigma * sqrt((1 - b^2) / (2 * a))
  shocks <- matrix(stats::rnorm(paths / 2L * months), nrow = paths / 2L)
  shocks <- rbind(shocks, -shocks)
  out <- matrix(0, paths, months); x <- rep(0, paths)
  for (m in seq_len(months)) {
    x <- b * x + sd * shocks[, m]
    time <- m * dt
    phi <- r + sigma^2 / (2 * a^2) * (1 - exp(-a * time))^2 # in the manuscript's order of operations
    out[, m] <- phi + x
  }
  out
}
CB_MBS_RATES <- cb_hw_monthly_manuscript()

cb_mbs <- function(p) cb_memo("mbs", p, function() {
  m <- CB_MBS
  pool <- rmql::create_mbs_pass_through(m$balance, m$mortgage_rate, m$pass_through_rate, maturity_months = m$months,
                                                  psa_multiplier = p$psaPct / 100, incentive_sensitivity = p$incentive,
                                                  refinancing_cost_rate = p$refiCostPct / 100, cpr_cap = 0.6, amortization = "fixed_payment")
  names3 <- c("借換え金利低下", "金利一定", "借換え金利上昇")
  paths <- list(c(rep(0.05, 24), rep(0.035, m$months - 24)), rep(0.05, m$months), c(rep(0.05, 24), rep(0.065, m$months - 24)))
  scen <- do.call(rbind, lapply(seq_along(paths), \(i) {
    f <- paths[[i]]
    fixed <- rmql::compute_mbs_path_values(pool, matrix(0.04, 1, m$months), matrix(f, 1))
    path <- rmql::compute_mbs_path_values(pool, matrix(f - 0.01, 1), matrix(f, 1))
    cf <- rmql::compute_mbs_cashflows(pool, f)
    data.frame(scenario = names3[i], weighted_average_life = fixed$weighted_average_life, price_fixed_discount = fixed$price,
               price_path_discount = path$price, total_principal = sum(cf$scheduled_principal + cf$prepaid_principal))
  }))
  cf_flat <- as.data.frame(rmql::compute_mbs_cashflows(pool, paths[[2]]))
  cpr <- data.frame(month = seq_len(m$months),
                    falling = rmql::compute_mbs_cashflows(pool, paths[[1]])$cpr, flat = cf_flat$cpr,
                    rising = rmql::compute_mbs_cashflows(pool, paths[[3]])$cpr)
  hw <- CB_MBS_RATES
  pv <- rmql::compute_mbs_path_values(pool, hw, pmax(hw + 0.03, 0))
  own <- cb_memo("mbs-own", p, function() {
    rates <- rmql::generate_hull_white_monthly_rates(m$own_paths, m$months, 0.02, 0.15, 0.012, seed = m$own_seed)
    v <- rmql::compute_mbs_path_values(pool, rates, pmax(rates + 0.03, 0))
    list(mean_price = mean(v$price), standard_error = stats::sd(v$price) / sqrt(nrow(v)), mean_wal = mean(v$weighted_average_life))
  })
  list(
    pool = list(balance = m$balance, mortgage_rate = m$mortgage_rate, pass_through_rate = m$pass_through_rate, months = m$months,
                psa = p$psaPct / 100, incentive = p$incentive, refinancing_cost = p$refiCostPct / 100),
    scenarios = scen, cpr = cpr,
    flat_cashflows = cf_flat[, c("month", "interest", "scheduled_principal", "prepaid_principal", "end_balance")],
    paths = list(seed = m$seed, count = nrow(hw), rates = lapply(seq_len(nrow(hw)), \(i) hw[i, ]),
                 price = pv$price, weighted_average_life = pv$weighted_average_life,
                 mean_price = mean(pv$price), mean_wal = mean(pv$weighted_average_life)),
    own_paths = c(list(count = m$own_paths, seed = m$own_seed), own)
  )
})

# II-8.8.1: static spreads by PSA at fictitious prices (fixed cash flows, refinancing rate 5%, no incentive), as the
# manuscript; and the price along the spread for each PSA (an addition of this page).
cb_static <- function() cb_memo("static", list(), function() {
  m <- CB_MBS
  grid <- expand.grid(assumed_price = c(95, 105), psa_percent = c(0, 50, 100))[, c("psa_percent", "assumed_price")]
  pool_at <- function(psa) rmql::create_mbs_pass_through(m$balance, m$mortgage_rate, m$pass_through_rate, maturity_months = m$months,
                                                                   psa_multiplier = psa / 100, incentive_sensitivity = 0)
  r4 <- matrix(0.04, 1, m$months); f5 <- matrix(0.05, 1, m$months)
  grid$oas_bp <- mapply(\(psa, price) 1e4 * rmql::compute_mbs_oas(pool_at(psa), price, r4, f5), grid$psa_percent, grid$assumed_price)
  spreads <- seq(-200, 300, by = 10)
  price_curve <- do.call(rbind, lapply(c(0, 50, 100), \(psa) {
    pool <- pool_at(psa)
    data.frame(psa_percent = psa, spread_bp = spreads,
               price = vapply(spreads, \(s) rmql::compute_mbs_path_values(pool, r4 + s / 1e4, f5)$price, 0))
  }))
  list(table = grid, price_curve = price_curve)
})

callable_compute <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  ranges <- list(
    bond = list(ratePct = c(-2, 10), aPct = c(1, 100), sigmaPct = c(0, 3), couponPct = c(0, 10), firstCallYear = c(0.5, 4.5), callPrice = c(90, 120)),
    mbs = list(psaPct = c(0, 500), incentive = c(0, 50), refiCostPct = c(0, 3))
  )
  read <- function(section) {
    given <- body[[section]]
    if (!is.null(given) && !is.list(given)) bad(sprintf("%s must be an object", section))
    unknown <- setdiff(names(given), names(CB_DEFAULTS[[section]]))
    if (length(unknown)) bad(sprintf("unknown field %s.%s", section, unknown[1]))
    p <- utils::modifyList(CB_DEFAULTS[[section]], if (is.null(given)) list() else given)
    for (k in names(ranges[[section]])) {
      x <- p[[k]]; lim <- ranges[[section]][[k]]
      if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= lim[1] && x <= lim[2])) bad(sprintf("%s.%s must be within %s and %s", section, k, lim[1], lim[2]))
    }
    p
  }
  b <- read("bond"); m <- read("mbs")
  if (abs(b$firstCallYear * 2 - round(b$firstCallYear * 2)) > 1e-9) bad("最初のコール日は利払日（0.5 年刻み）にしてください")
  list(
    inputs = list(bond = b, mbs = m),
    conventions = list(
      bond = "額面100、5年、半年ごとのクーポン、コールはクーポン支払後に元本をコール価格で償還。フラットな連続複利の初期曲線、Hull–White 1因子。状態の格子 321 点（±0.13）、Gauss–Hermite 24 点（rmql compute_hull_white_callable_bond_value）。コール判断の表は原稿の R 関数（同じ格子と求積）",
      mbs = "パススルー（元本100、モーゲージ金利 5%、パススルー金利 4.5%、360か月、元の毎月返済額を維持）。CPR = min(0.6, PSA × min(0.002m, 0.06) × exp(β(c − f − k)))。Hull–White の20経路は原稿の乱数（R の seed 48、antithetic）、借換え金利は短期金利 + 3%",
      static = "静的 OAS：PSA 0・50・100%、借換え金利 5% でインセンティブなし、ゼロ金利 4% にスプレッドを加えて架空の価格 95・105 に合わせる",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))),
    bond = cb_bond(b), mbs = cb_mbs(m), static = cb_static()
  )
}
