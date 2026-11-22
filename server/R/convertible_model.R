# Convertible bonds and MSCB (chapters 13.3 to 13.5): rmql's lattice with the Tsiveriotis-Fernandes treatment of credit risk
# (compute_convertible_bond_value), the conversion price reset at conversion (compute_reset_convertible_bond_value) and the
# conversion price carried between resets (compute_carried_reset_convertible_bond_value, a grid of conversion prices or the
# scaled lattice). The bond is a semiannual fixed-rate bond issued on the settlement date (P16_SETTLEMENT), face 100.
# Needs lookback_model.R (the limits and the checks). The formulas of the conversion value and of the conversion price along
# a share-price scenario are the chapter's teaching formulas, written here in R and shown next to rmql's values.
#
# POST /api/convertible
#   {"bond": {"remainingYears": 5, "couponPct": 2, "redemption": 100},
#    "conversion": {"kind": "fixed", "ratio": 1.0}            or {"kind": "reset", "priceRatio": 0.9, "lowerPrice": 80, "upperPrice": null},
#    "exercise": "american", "exerciseYears": [],              (the years of a Bermudan conversion, multiples of 0.5)
#    "callabilities": [{"years": 3, "kind": "call", "price": 108, "priceType": "dirty", "trigger": null}],
#    "market": {"spot": 100, "ratePct": 3, "dividendYieldPct": 1, "volatilityPct": 25, "creditSpreadPct": 2},
#    "steps": 200}
# POST /api/mscb
#   the same bond, market, exercise, callabilities and steps, and
#   {"conversion": {"initialPrice": 100, "priceRatio": 0.9, "lowerPrice": 0, "upperPrice": null}, "resetYears": [1, 2, 3, 4],
#    "rule": "downward_only", "method": "scaled", "priceNodes": 40, "greeks": true, "scenario": "down"}
# GET /api/lookback-convertible/summary   the precomputed results (server/data/p16/*.json)

CONVERTIBLE_COLUMNS <- c("value", "delta", "gamma", "vega", "rho", "dividend_rho", "credit_spread_sensitivity")
P16_DATA_DIR <- file.path(script_dir, "data", "p16")
P16_FILES <- c(lookback_convergence = "lookback_convergence.json", convertible_curve = "convertible_curve.json",
               mscb_reset_closed_form = "mscb_reset_closed_form.json", mscb_carried_grid = "mscb_carried_grid.json")

# A time in years that is a multiple of half a year, as a date after the settlement date.
p16_date <- function(years) seq(as.Date(P16_SETTLEMENT), by = paste(as.integer(round(12 * years)), "months"), length.out = 2L)[2]

p16_half_years <- function(x, label, lo, hi) {
  if (!(is.numeric(x) && all(is.finite(x)))) p16_bad(sprintf("%sは数値の並びにしてください", label))
  if (any(abs(2 * x - round(2 * x)) > 1e-9)) p16_bad(sprintf("%sは 0.5 年の倍数にしてください", label))
  if (any(x <= lo) || any(x > hi)) p16_bad(sprintf("%sは %s 年より後、%s 年までにしてください", label, p16_fmt(lo), p16_fmt(hi)))
  if (is.unsorted(x, strictly = TRUE)) p16_bad(sprintf("%sは増える順にしてください", label))
  x
}

# The bond, the market, the exercise, the callabilities and the steps of a request.
p16_request <- function(body, max_steps, default_steps, allow_trigger) {
  b <- body$bond
  if (!is.null(b) && !is.list(b)) p16_bad("bond は JSON のオブジェクトにしてください")
  p16_unknown(b, c("remainingYears", "couponPct", "redemption"), "bond.")
  lim <- P16_LIMITS$convertible
  remaining <- p16_num(b$remainingYears, "残存年数", lim$remaining_years[1], lim$remaining_years[2], 5, whole = TRUE)
  coupon <- p16_num(b$couponPct, "クーポン（%）", 0, 20, 2) / 100
  redemption <- p16_num(b$redemption, "償還額", 1, 1000, 100)
  m <- body$market
  if (!is.null(m) && !is.list(m)) p16_bad("market は JSON のオブジェクトにしてください")
  p16_unknown(m, c("spot", "ratePct", "dividendYieldPct", "volatilityPct", "creditSpreadPct"), "market.")
  market <- list(
    spot = p16_num(m$spot, "現物", 1e-6, 1e6, 100),
    rate = p16_num(m$ratePct, "金利（%）", -5, 30, 3) / 100,
    dividend = p16_num(m$dividendYieldPct, "配当利回り（%）", -5, 30, 1) / 100,
    volatility = p16_num(m$volatilityPct, "ボラティリティ（%）", 1, 200, 25) / 100,
    spread = p16_num(m$creditSpreadPct, "信用スプレッド（%）", 0, 50, 2) / 100
  )
  steps <- p16_num(body$steps, "段数", 2, max_steps, default_steps, whole = TRUE)
  exercise <- p16_choice(body$exercise, "exercise", c("european", "american", "bermudan"), "american")
  settle <- as.Date(P16_SETTLEMENT)
  maturity <- p16_date(remaining)
  exercise_dates <- switch(exercise, european = maturity, american = c(settle, maturity),
                           bermudan = {
                             years <- p16_half_years(body$exerciseYears, "exerciseYears", 0, remaining)
                             if (length(years) > 20) p16_bad("バミューダン型の行使日は 20 までにしてください")
                             vapply(years, \(y) as.numeric(p16_date(y)), 0) |> as.Date(origin = "1970-01-01")
                           })
  calls <- NULL
  cl <- body$callabilities
  if (!(is.null(cl) || length(cl) == 0L)) {
    if (!is.data.frame(cl)) p16_bad("callabilities は、years・kind・price を持つオブジェクトの配列にしてください")
    if (nrow(cl) > lim$callabilities) p16_bad(sprintf("コール・プットは %d 行までにしてください", lim$callabilities))
    p16_unknown(cl, c("years", "kind", "price", "priceType", "trigger"), "callabilities[].")
    if (!all(c("years", "kind", "price") %in% names(cl))) p16_bad("callabilities の各行に years・kind・price が必要です")
    if (!(is.numeric(cl$years) && all(is.finite(cl$years)))) p16_bad("callabilities の years は数値にしてください")
    if (any(abs(2 * cl$years - round(2 * cl$years)) > 1e-9) || any(cl$years <= 0) || any(cl$years > remaining))
      p16_bad(sprintf("callabilities の years は、0.5 年の倍数で、0 年より後、%d 年までにしてください", remaining))
    if (!all(cl$kind %in% c("call", "put"))) p16_bad("callabilities の kind は call か put にしてください")
    if (!(is.numeric(cl$price) && all(is.finite(cl$price)) && all(cl$price > 0) && all(cl$price <= 1000))) p16_bad("callabilities の price は 0 より大きく 1000 以下にしてください")
    price_type <- if (is.null(cl$priceType)) rep("dirty", nrow(cl)) else cl$priceType
    price_type[is.na(price_type)] <- "dirty"
    if (!all(price_type %in% c("clean", "dirty"))) p16_bad("callabilities の priceType は clean か dirty にしてください")
    trigger <- if (is.null(cl$trigger)) rep(NA_real_, nrow(cl)) else as.numeric(cl$trigger)
    if (any(!is.na(trigger)) && (!allow_trigger)) p16_bad("転換価額がリセットされる契約では、ソフトコール（trigger）は使えません（固定の転換比率がありません）")
    if (any(!is.na(trigger) & trigger <= 0) || any(!is.na(trigger) & cl$kind == "put")) p16_bad("trigger は 0 より大きく、コールだけに指定できます")
    calls <- data.frame(date = vapply(cl$years, \(y) as.numeric(p16_date(y)), 0) |> as.Date(origin = "1970-01-01"), kind = cl$kind, price = cl$price,
                        price_type = price_type, trigger = trigger)
  }
  bond <- rmql::create_fixed_rate_bond(0L, 100, settle, maturity, "6M", "japan", "unadjusted", "unadjusted", "backward", FALSE, coupon,
                                       "actual_365_fixed", "unadjusted", redemption)
  list(bond = bond, remaining = remaining, coupon = coupon, redemption = redemption, market = market, steps = steps, exercise = exercise,
       exercise_dates = exercise_dates, calls = calls, settle = settle, maturity = maturity)
}

p16_request_echo <- function(r) {
  list(remainingYears = r$remaining, couponPct = 100 * r$coupon, redemption = r$redemption, spot = r$market$spot, ratePct = 100 * r$market$rate,
       dividendYieldPct = 100 * r$market$dividend, volatilityPct = 100 * r$market$volatility, creditSpreadPct = 100 * r$market$spread,
       exercise = r$exercise, steps = r$steps, settlement_date = format(r$settle), maturity_date = format(r$maturity))
}

# The conversion value of a bond of face 100 at the share prices `spots`: the teaching formulas.
p16_conversion_value <- function(spots, conversion) {
  if (conversion$kind == "fixed") return(conversion$ratio * spots)
  100 * pmax(spots / conversion$upper, pmin(spots / conversion$lower, 1 / conversion$alpha))
}

convertible_compute <- function(body = list()) {
  if (!is.list(body)) p16_bad("本文は JSON のオブジェクトにしてください")
  p16_unknown(body, c("bond", "conversion", "exercise", "exerciseYears", "callabilities", "market", "steps"))
  cv <- body$conversion
  if (!is.null(cv) && !is.list(cv)) p16_bad("conversion は JSON のオブジェクトにしてください")
  p16_unknown(cv, c("kind", "ratio", "priceRatio", "lowerPrice", "upperPrice"), "conversion.")
  kind <- p16_choice(cv$kind, "conversion.kind", c("fixed", "reset"), "fixed")
  r <- p16_request(body, P16_LIMITS$convertible$steps[2], 200L, allow_trigger = kind == "fixed")
  m <- r$market
  if (kind == "fixed") {
    ratio <- p16_num(cv$ratio, "転換比率", 1e-6, 100, 1)
    result <- p16_rmql(rmql::compute_convertible_bond_value(r$bond, r$settle, r$exercise, r$exercise_dates, ratio, m$spot, m$rate, m$dividend,
                                                            m$volatility, m$spread, as.integer(r$steps), r$calls))
    conversion <- list(kind = "fixed", ratio = ratio)
    echo <- list(kind = "fixed", ratio = ratio)
  } else {
    alpha <- p16_num(cv$priceRatio, "価格の比", 0.01, 3, 0.9)
    lower <- p16_num(cv$lowerPrice, "転換価額の下限", 1e-6, 1e6, 80)
    upper <- if (is.null(cv$upperPrice)) Inf else p16_num(cv$upperPrice, "転換価額の上限", lower, 1e9, Inf)
    result <- p16_rmql(rmql::compute_reset_convertible_bond_value(r$bond, r$settle, r$exercise, r$exercise_dates, alpha, lower, upper, m$spot, m$rate,
                                                                  m$dividend, m$volatility, m$spread, as.integer(r$steps), r$calls))
    conversion <- list(kind = "reset", alpha = alpha, lower = lower, upper = upper)
    echo <- list(kind = "reset", priceRatio = alpha, lowerPrice = lower, upperPrice = if (is.finite(upper)) upper else NULL)
  }
  spots <- seq(0.4, 1.8, length.out = 29) * m$spot
  values <- p16_values(result, CONVERTIBLE_COLUMNS)
  # a reset conversion price with a price ratio below 1: above lower / ratio the holder converts at once for face / ratio
  immediate <- kind == "reset" && conversion$alpha < 1 && m$spot >= conversion$lower / conversion$alpha &&
    values$value >= 100 / conversion$alpha - 1e-9 && r$exercise == "american"
  list(
    inputs = c(p16_request_echo(r), list(conversion = echo)),
    values = values,
    conversion_value = list(spots = spots, values = p16_conversion_value(spots, conversion)),
    immediate_conversion = immediate,
    limits = P16_LIMITS$convertible,
    conventions = list(
      method = "価値と転換確率を持つ二項格子（Tsiveriotis–Fernandes）。転換した節点は金利、しなかった節点は金利＋信用スプレッドで割り引き、転換確率で混ぜる",
      bond = sprintf("額面 100、クーポン %.2f%%（半年ごと）、残存 %d 年の固定利付債。決済日は %s", 100 * r$coupon, r$remaining, P16_SETTLEMENT),
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))
    )
  )
}

# The conversion price along a share-price scenario: the rule applied on each reset date (the teaching formula).
p16_scenario <- function(name, spot, reset_years, initial, rule, alpha, lower, upper) {
  drift <- c(down = -0.15, flat = 0, up = 0.15)[[name]]
  s <- spot * exp(drift * reset_years)
  k <- numeric(length(s)); previous <- initial
  for (i in seq_along(s)) {
    k[i] <- if (rule == "both") min(upper, max(lower, alpha * s[i])) else min(previous, max(lower, alpha * s[i]))
    previous <- k[i]
  }
  list(name = name, drift_per_year = drift, reset_years = reset_years, share_price = s, conversion_price = k, conversion_ratio = 100 / k)
}

mscb_compute <- function(body = list()) {
  if (!is.list(body)) p16_bad("本文は JSON のオブジェクトにしてください")
  p16_unknown(body, c("bond", "conversion", "exercise", "exerciseYears", "callabilities", "market", "steps", "resetYears", "rule", "method",
                      "priceNodes", "greeks", "scenario"))
  lim <- P16_LIMITS$mscb
  method <- p16_choice(body$method, "method", c("scaled", "grid"), "scaled")
  rule <- p16_choice(body$rule, "rule", c("downward_only", "both"), "downward_only")
  greeks <- if (is.null(body$greeks)) method == "scaled" else body$greeks
  if (!(is.logical(greeks) && length(greeks) == 1L && !is.na(greeks))) p16_bad("greeks は true か false にしてください")
  if (method == "grid" && greeks) p16_bad("転換価額の格子では、グリークスはライブで求めません（1 秒を超えます）。greeks を false にするか、事前計算の結果（/api/lookback-convertible/summary）を見てください")
  r <- p16_request(body, lim$steps[2], 200L, allow_trigger = TRUE)
  m <- r$market
  cv <- body$conversion
  if (!is.null(cv) && !is.list(cv)) p16_bad("conversion は JSON のオブジェクトにしてください")
  p16_unknown(cv, c("initialPrice", "priceRatio", "lowerPrice", "upperPrice"), "conversion.")
  initial <- p16_num(cv$initialPrice, "最初の転換価額", 1e-6, 1e6, 100)
  alpha <- p16_num(cv$priceRatio, "価格の比", 0.01, 3, 0.9)
  lower <- p16_num(cv$lowerPrice, "転換価額の下限", 0, 1e6, 0)
  upper <- if (is.null(cv$upperPrice)) Inf else p16_num(cv$upperPrice, "転換価額の上限", max(lower, 1e-6), 1e9, Inf)
  years <- body$resetYears
  if (is.null(years) || length(years) == 0L) years <- numeric()
  if (length(years) > lim$reset_dates) p16_bad(sprintf("リセット日は %d 回までにしてください", lim$reset_dates))
  if (length(years)) years <- p16_half_years(years, "resetYears", 0, r$remaining)
  nodes <- 0L
  if (method == "scaled") {
    if (lower != 0 || is.finite(upper)) p16_bad("1 次元の縮約（scaled）では、転換価額の下限と上限は使えません（下限 0、上限なし）。限度があるときは method を grid にしてください")
  } else {
    nodes <- as.integer(p16_num(body$priceNodes, "転換価額の点数", lim$price_nodes[1], lim$price_nodes[2], 40, whole = TRUE))
    if (nodes * r$steps > lim$grid_work) p16_bad(sprintf("転換価額の点数 × 段数は %s 以下にしてください（%d × %d = %s）", p16_fmt(lim$grid_work), nodes, as.integer(r$steps), p16_fmt(nodes * r$steps)))
  }
  scenario <- NULL
  if (!is.null(body$scenario)) {
    name <- p16_choice(body$scenario, "scenario", c("down", "flat", "up"), "flat")
    scenario <- p16_scenario(name, m$spot, years, initial, rule, alpha, lower, upper)
  }
  result <- p16_rmql(rmql::compute_carried_reset_convertible_bond_value(
    r$bond, r$settle, r$exercise, r$exercise_dates, vapply(years, \(y) as.numeric(p16_date(y)), 0) |> as.Date(origin = "1970-01-01"), rule, alpha, initial,
    lower, upper, m$spot, m$rate, m$dividend, m$volatility, m$spread, as.integer(r$steps), method, nodes, greeks, r$calls))
  list(
    inputs = c(p16_request_echo(r), list(conversion = list(initialPrice = initial, priceRatio = alpha, lowerPrice = lower, upperPrice = if (is.finite(upper)) upper else NULL),
                                         resetYears = years, rule = rule, method = method, priceNodes = nodes, greeks = greeks)),
    values = p16_values(result, CONVERTIBLE_COLUMNS),
    scenario = scenario,
    limits = lim,
    conventions = list(
      method = if (method == "scaled") "株価と転換価額の比 z = S/K の 1 次元の格子。リセットは z の写像（downward_only：max(z, 1/α)、both：1/α）"
               else "転換価額の格子ごとに現物の格子を持ち、リセット日に、1/K について線形に補間してつなぐ",
      reset = "リセットは、その日の転換の前に行う。新しい転換価額は、その日の株価で決まる",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))
    )
  )
}

lookback_convertible_summary <- function() {
  files <- file.path(P16_DATA_DIR, P16_FILES)
  missing <- !file.exists(files)
  if (any(missing)) stop("事前計算の結果がありません：", paste(P16_FILES[missing], collapse = "、"),
                         "。Rscript server/scripts/p16/<名前>.R で作ってください。", call. = FALSE)
  out <- lapply(files, \(f) jsonlite::fromJSON(f, simplifyVector = FALSE))
  names(out) <- names(P16_FILES)
  out$limits <- P16_LIMITS
  out$engine <- paste("rmql", as.character(utils::packageVersion("rmql")))
  out
}
