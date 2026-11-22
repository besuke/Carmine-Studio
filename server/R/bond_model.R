# Deterministic cash flows (Coral-Book II-1). All calculations are rmql, except the manuscript's own
# teaching formulas (the closed-form price of a regular semiannual bond, its derivatives, and the root finders of
# II-1.8), which are written here in R as in the manuscript and compared with rmql. Reconciled with
# GaussQuant running the manuscript's code, and with the manuscript's own results, in server/tests/reconciliation/bond/.
#
# POST /api/bond
#   {"shapes": {"normalLevelPct": 1, "normalSlopePct": 0.2, "invertedLevelPct": 3.5, "invertedSlopePct": -0.15},
#    "bond":   {"simpleYieldPct": 6.515, "couponPct": 7.5, "zSpreadBp": 50,
#               "tradeDate": "2022-03-30", "issueDate": "2022-04-01", "maturityDate": "2062-04-01"}}
# Every field is optional; the defaults are the manuscript's examples. The TONAR quotes are GaussQuant's sample
# quotes (BlueGamma TONAR OIS as of 2026-09-10), as in the OIS chapter.

BOND_DATES <- list(trade = "2022-03-30", issue = "2022-04-01", maturity = "2062-04-01")
BOND_DEFAULTS <- list(
  shapes = list(normalLevelPct = 1, normalSlopePct = 0.2, invertedLevelPct = 3.5, invertedSlopePct = -0.15),
  bond = list(simpleYieldPct = 6.515, couponPct = 7.5, zSpreadBp = 50,
              tradeDate = BOND_DATES$trade, issueDate = BOND_DATES$issue, maturityDate = BOND_DATES$maturity)
)
BOND_DC <- "thirty_360_bond_basis"

BOND_TONAR <- local({
  q <- GaussQuant::bluegamma_tonar_quotes_GQL()
  date <- "2026-09-10"
  tenor <- paste0(q$tenor_n, ifelse(q$tenor_unit == "Years", "Y", "M"))
  curve <- rmql::with_extrapolation(rmql::bootstrap_ois_curve(
    date, date, "tonar", "actual_365_fixed", rmql::create_ois_instruments(tenor, q$rate, 2L, 1L, 0L)))
  pillars <- rmql::get_quote_repricing(curve)
  list(date = date, quotes = data.frame(quote_id = q$quote_id, tenor = tenor, rate = q$rate), curve = curve, pillars = pillars)
})

# II-1.2.4: par (the quote), continuous zero and instantaneous forward at the pillars (QuantLib's forwardRate(d, d)).
bond_tonar <- function() {
  tc <- BOND_TONAR
  pillar <- as.Date(tc$pillars$pillar_date)
  v <- rmql::compute_curve_values(tc$curve, pillar, "actual_365_fixed")
  data.frame(
    quote_id = tc$quotes$quote_id, tenor = tc$quotes$tenor, pillar_date = format(pillar), par_rate = tc$quotes$rate,
    discount_factor = v$discount, zero_rate = v$zero_continuous,
    inst_fwd_rate = rmql::compute_forward_rate(tc$curve, pillar, pillar, "actual_365_fixed", "continuous"),
    repricing_error = tc$pillars$reproduction_error
  )
}

# II-1.2.5: annual spot rates rising or falling linearly; discount factors, par rates and 1-year forwards.
bond_shapes <- function(s) {
  shape <- function(name, level, slope) {
    m <- 1:10
    spot <- (level + slope * m) / 100
    df <- (1 + spot)^(-m)
    data.frame(curve_shape = name, maturity = m, spot_rate = spot, discount_factor = df,
               forward_rate = c(1, head(df, -1)) / df - 1, par_rate = (1 - df) / cumsum(df))
  }
  rbind(shape("順イールド", s$normalLevelPct, s$normalSlopePct), shape("逆イールド", s$invertedLevelPct, s$invertedSlopePct))
}

# II-1.7: the manuscript's closed-form price of a regular semiannual bond and its derivatives, the yield Y in percent.
bond_price_formula <- function(Y, C, T) {
  if (Y == 0) return(100 + C * T)
  a <- 1 / (1 + Y / 200)
  100 * (C / Y * (1 - a^(2 * T)) + a^(2 * T))
}
bond_dprice_formula <- function(Y, C, T) {
  if (Y == 0) return(-(C * T * (2 * T + 1) / 400 + T))
  a <- 1 / (1 + Y / 200)
  -100 * C / Y^2 * (1 - a^(2 * T)) - (1 - C / Y) * T * a^(2 * T + 1)
}
bond_d2price_formula <- function(Y, C, T) {
  if (Y == 0) return(T * (2 * T + 1) / 20000 * (C * (T + 1) / 3 + 100))
  a <- 1 / (1 + Y / 200)
  T * (2 * T + 1) / 200 * (1 - C / Y) * a^(2 * T + 2) - 2 * C * T / Y^2 * a^(2 * T + 1) + 200 * C / Y^3 * (1 - a^(2 * T))
}

# II-1.8: root finders on f(Y) = P(Y) - P_market, as in the manuscript, keeping each step for the page.
# With keep = FALSE only the root is returned (for timing the method itself, not the table of its steps).
bond_newton <- function(f, df, y0, tol = 1e-12, max_iter = 100L, keep = TRUE) {
  steps <- list(); y <- y0
  for (k in seq_len(max_iter)) {
    fy <- f(y); d <- df(y)
    if (keep) steps[[k]] <- data.frame(iteration = k, yield_pct = y, objective = fy, derivative = d)
    if (abs(fy) < tol) break
    y <- y - fy / d
  }
  if (keep) list(root = y, steps = do.call(rbind, steps)) else y
}
bond_bisection <- function(f, lower = -1, upper = 20, tol = 1e-12, max_iter = 200L, keep = TRUE) {
  steps <- list(); root <- NA_real_
  for (k in seq_len(max_iter)) {
    mid <- (lower + upper) / 2
    fl <- f(lower); fm <- f(mid)
    if (keep) steps[[k]] <- data.frame(iteration = k, lower = lower, upper = upper, midpoint = mid, objective = fm)
    root <- mid
    if (abs(fm) < tol || abs(upper - lower) < tol) break
    if (sign(fl) == sign(fm)) lower <- mid else upper <- mid
  }
  if (keep) list(root = root, steps = do.call(rbind, steps)) else root
}
bond_polyroot <- function(price, coupon_half, periods, f) {
  roots <- polyroot(c(-price, rep(coupon_half, periods - 1L), coupon_half + 100))
  real <- roots[abs(Im(roots)) < 1e-10 & Re(roots) > 0]
  candidates <- (1 / Re(real) - 1) * 200
  list(root = candidates[which.min(abs(vapply(candidates, f, 0)))], roots = length(roots), real_positive = length(real))
}
BOND_TIMING <- new.env(parent = emptyenv())
# Repeat until 50 ms have passed (the clock ticks in steps of about 10 ms on Windows), and give the time of one run.
bond_time_us <- function(fun, reps = 8L) {
  fun()
  repeat {
    t0 <- proc.time()[["elapsed"]]
    for (i in seq_len(reps)) fun()
    elapsed <- proc.time()[["elapsed"]] - t0
    if (elapsed >= 0.05 || reps >= 2^20) return(elapsed * 1e6 / reps)
    reps <- reps * 2L
  }
}

bond_value <- function(p) {
  d <- list(trade = p$tradeDate, issue = p$issueDate, maturity = p$maturityDate)
  bond <- rmql::create_fixed_rate_bond(
    settlement_days = 2L, face_amount = 100, effective_date = d$issue, termination_date = d$maturity, tenor = "6M", calendar = "japan",
    convention = "unadjusted", termination_convention = "unadjusted", rule = "backward", end_of_month = FALSE,
    coupon_rate = p$couponPct / 100, day_count = BOND_DC, payment_convention = "unadjusted", redemption = 100, issue_date = d$issue)
  settlement <- rmql::compute_settlement_date(bond, d$trade)
  cf <- rmql::get_bond_cashflows(bond)
  # II-1.4: Japanese simple yield -> price (truncated to 3 decimals) -> compound yield (truncated to 3 decimals)
  trunc3 <- function(x) trunc(x * 1000) / 1000
  t <- rmql::compute_remaining_years(settlement, d$maturity)
  C <- p$couponPct
  price <- rmql::compute_price_from_simple_rate(t, C, p$simpleYieldPct, 100)
  simple_back <- rmql::compute_simple_rate_from_price(t, C, price, 100)
  Y_raw <- rmql::compute_compound_yield_from_price(t, C, price, 100)
  Y <- trunc3(Y_raw)
  compound_price <- rmql::compute_price_from_compound_yield(t, C, Y_raw, 100)
  accrued <- rmql::compute_accrued_amount(bond, settlement)
  y <- Y_raw / 100
  # II-1.5.3–1.5.4 and II-1.6.2: flat curve at the compound yield (30/360, semiannual), its continuous equivalent,
  # and the value with a zero spread on that curve
  flat <- rmql::create_flat_curve(settlement, y, BOND_DC, "compounded", 2L)
  # evaluated on the trade date, as QuantLib's evaluation date; the bond settles two business days later
  flat_value <- rmql::compute_bond_value_on_curve(bond, flat, d$trade)
  z <- p$zSpreadBp / 1e4
  z_value <- rmql::compute_bond_value_with_zero_spread(bond, flat, z, "compounded", 2L, d$trade)
  z_back <- rmql::compute_z_spread_from_price(bond, flat, z_value$npv, "dirty", "compounded", 2L, settlement)
  # II-1.7: risk by the manuscript's formulas and by rmql (duration and convexity truncated to 3 decimals)
  risk <- as.list(rmql::compute_risk_from_compound_yield(t, C, Y_raw, 100, accrued))
  risk$modified_duration <- trunc3(risk$modified_duration)
  risk$convexity <- trunc3(risk$convexity)
  Pf <- bond_price_formula(Y_raw, C, t); dP <- bond_dprice_formula(Y_raw, C, t); d2P <- bond_d2price_formula(Y_raw, C, t)
  formula <- list(price = Pf, dp_dy_pct = dP, d2p_dy2_pct = d2P, bpv_sen = -dP, bpv_yen = -dP / 100,
                  modified_duration = trunc3(-100 * dP / (Pf + accrued)), convexity = trunc3(1e4 * d2P / (Pf + accrued)))
  zero <- list(price = bond_price_formula(0, C, t), dp_dy_pct = bond_dprice_formula(0, C, t), d2p_dy2_pct = bond_d2price_formula(0, C, t))
  zero$modified_duration <- trunc3(-100 * zero$dp_dy_pct / zero$price)
  zero$convexity <- trunc3(1e4 * zero$d2p_dy2_pct / zero$price)
  # price-yield curve with the first- and second-order approximations around Y
  grid <- seq(0, 15, by = 0.25)
  price_yield <- data.frame(
    yield_pct = grid, price = vapply(grid, bond_price_formula, 0, C = C, T = t),
    duration_approx = Pf + dP * (grid - Y_raw), convexity_approx = Pf + dP * (grid - Y_raw) + 0.5 * d2P * (grid - Y_raw)^2)
  # II-1.8: the same compound yield by the root finders
  f <- function(yy) bond_price_formula(yy, C, t) - price
  dfn <- function(yy) bond_dprice_formula(yy, C, t)
  periods <- as.integer(round(2 * t))
  newton <- bond_newton(f, dfn, p$simpleYieldPct)
  bisection <- bond_bisection(f)
  brent <- stats::uniroot(f, c(-1, 20), tol = 1e-12)
  poly <- bond_polyroot(price, C / 2, periods, f)
  ql_style <- 100 * rmql::compute_yield_from_price(bond, price, "clean", BOND_DC, "compounded", 2L, settlement, accuracy = 1e-8)
  solvers <- data.frame(
    method = c("ニュートン・ラフソン法", "二分法", "Brent法（uniroot）", "多項式求根法（polyroot）",
               "rmql：compute_compound_yield_from_price（3桁切り捨て）", "rmql：compute_yield_from_price（精度 1e-8）"),
    yield_pct = c(newton$root, bisection$root, brent$root, poly$root, Y, ql_style),
    iterations = c(nrow(newton$steps), nrow(bisection$steps), brent$iter, NA, NA, NA)
  )
  solvers$price_error <- vapply(solvers$yield_pct, f, 0)
  # average time of one solve (R, this server), kept per input like the other results
  solvers$average_us <- BOND_TIMING[[timing_key <- paste(format(c(C, price, t), digits = 17), collapse = "|")]] %||% (BOND_TIMING[[timing_key]] <- c(
    bond_time_us(function() bond_newton(f, dfn, p$simpleYieldPct, keep = FALSE)), bond_time_us(function() bond_bisection(f, keep = FALSE)),
    bond_time_us(function() stats::uniroot(f, c(-1, 20), tol = 1e-12)), bond_time_us(function() bond_polyroot(price, C / 2, periods, f), 50L),
    bond_time_us(function() rmql::compute_compound_yield_from_price(t, C, price, 100, digits = 3L)),
    bond_time_us(function() rmql::compute_yield_from_price(bond, price, "clean", BOND_DC, "compounded", 2L, settlement, accuracy = 1e-8))))
  list(
    trade_date = d$trade, settlement_date = format(settlement), issue_date = d$issue, maturity_date = d$maturity,
    coupon_pct = C, simple_yield_pct = p$simpleYieldPct, z_spread_bp = p$zSpreadBp,
    cashflows = data.frame(payment_date = format(cf$payment_date), amount = cf$amount, kind = cf$kind,
                           accrual_start = format(cf$accrual_start), accrual_end = format(cf$accrual_end)),
    remaining_years = t, clean_price = price, simple_from_price = simple_back, compound_yield_pct = Y, compound_price = compound_price,
    accrued = accrued, dirty_price = price + accrued,
    flat_dirty_price = flat_value$npv, continuous_yield = trunc3(2 * log1p(y / 2) * 100) / 100,
    z_spread_npv = z_value$npv, z_spread_back_bp = 1e4 * z_back,
    risk = risk, formula = formula, zero_yield = zero, price_yield = price_yield,
    solvers = solvers, newton_steps = newton$steps, bisection_steps = head(bisection$steps, 60),
    bisection_iterations = nrow(bisection$steps), polyroot = list(degree = periods, roots = poly$roots, real_positive = poly$real_positive)
  )
}

bond_compute <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  ranges <- list(
    shapes = list(normalLevelPct = c(-2, 15), normalSlopePct = c(-1, 1), invertedLevelPct = c(-2, 15), invertedSlopePct = c(-1, 1)),
    bond = list(simpleYieldPct = c(0.1, 15), couponPct = c(0, 15), zSpreadBp = c(-500, 1000))
  )
  read <- function(section) {
    given <- body[[section]]
    if (!is.null(given) && !is.list(given)) bad(sprintf("%s must be an object", section))
    unknown <- setdiff(names(given), names(BOND_DEFAULTS[[section]]))
    if (length(unknown)) bad(sprintf("unknown field %s.%s", section, unknown[1]))
    p <- utils::modifyList(BOND_DEFAULTS[[section]], if (is.null(given)) list() else given)
    for (k in names(ranges[[section]])) {
      x <- p[[k]]; lim <- ranges[[section]][[k]]
      if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= lim[1] && x <= lim[2])) bad(sprintf("%s.%s must be within %s and %s", section, k, lim[1], lim[2]))
    }
    if (section == "bond") {
      dt <- lapply(p[c("tradeDate", "issueDate", "maturityDate")], function(x)
        if (is.character(x) && length(x) == 1L && grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", x)) as.Date(x, format = "%Y-%m-%d") else as.Date(NA))
      for (k in names(dt)) if (is.na(dt[[k]])) bad(sprintf("bond.%s must be a date as YYYY-MM-DD", k))
      if (abs(as.numeric(dt$tradeDate - dt$issueDate)) > 366) bad("bond.tradeDate must be within a year of bond.issueDate")
      years <- as.numeric(dt$maturityDate - dt$issueDate) / 365.25
      if (years < 1 || years > 60) bad("bond.maturityDate must be 1 to 60 years after bond.issueDate")
    }
    p
  }
  shapes <- read("shapes"); b <- read("bond")
  list(
    inputs = list(shapes = shapes, bond = b),
    conventions = list(
      tonar = sprintf("TONAR OIS：%s 時点の GaussQuant のサンプル気配（BlueGamma、14本）。スポット開始2日、年1回払い、Japan、MonotonicLogCubic。フォワードは QuantLib の forwardRate(d, d) と同じ瞬間フォワード", BOND_TONAR$date),
      bond = "固定利付債：額面100、半年払い、30/360（Bond Basis）、日付は調整なし、Backward、受渡は取引日の2営業日後（Japan）",
      yen = "単利→単価は日本の計算規則（残存年数は年＋日/365 を小数7桁で切り捨て、単価は小数3桁で切り捨て）、複利利回り・修正デュレーション・コンベクシティは小数3桁（4桁目切り捨て）",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))),
    tonar = bond_tonar(), shapes = bond_shapes(shapes), bond = bond_value(b)
  )
}
