# Chapter 15 (extension): the sensitivities of the three-factor PRDC without a call, by automatic differentiation and by
# finite differences, side by side. The note is the one of prdc_risk_model.R (five annual coupons, notional 100 million
# yen); the model is rmql's three-factor model (FX lognormal, Hull-White domestic and foreign short rates, three
# correlations), valued in closed form. See rmql docs/spec_prdc.md, sections 5 and 7.
#
# POST /api/prdc-three-factor   {"correlation": {"domesticForeign": 0.3, "domesticFx": -0.2, "foreignFx": 0.4}}
#
# Automatic differentiation (rmql, one valuation with second_order = TRUE): the value, the spot delta, the FX vega, the three
# correlations, and the cross second derivatives with the spot (the cross-gammas with a parallel shift of each curve, the Vanna).
# The finite-difference columns are central differences (correlations) and four-point differences (cross second derivatives) of
# the value alone. Bump widths are in P3_BUMP and apply to the finite differences: they are inside the range where the finite
# differences are stable (server/tests/reconciliation/prdc_three_factor/RECONCILIATION_PRDC_THREE_FACTOR.md).
#
# Needs prdc_risk_model.R (PR_NOTE, PR_TIMES, PR_REF, PR_DATES), loaded before this file.

P3_DEFAULTS <- list(correlation = list(domesticForeign = 0.3, domesticFx = -0.2, foreignFx = 0.4))
P3_MODEL <- list(spot = 150, fx_volatility = 0.12, domestic = c(mean_reversion = 0.03, volatility = 0.01),
                 foreign = c(mean_reversion = 0.05, volatility = 0.012))
# relative or absolute widths of the finite differences
P3_BUMP <- list(correlation = 1e-3, spot = 1e-4 * 150, volatility = 1e-4, rate = 1e-5)

p3_curve <- function(rates, index, shift = 0) {
  df <- exp(-cumsum(rates)) * exp(-shift * PR_TIMES) # a parallel shift of the continuous zero rates
  rmql::create_discount_curve(c(PR_REF, PR_DATES), c(1, df), "actual_365_fixed", index = index)
}

p3_value <- function(spot, vol, rho, domestic_shift = 0, foreign_shift = 0, second_order = FALSE) {
  n <- PR_NOTE; m <- P3_MODEL
  rmql::compute_prdc_three_factor_value(spot, vol, p3_curve(n$jpy, "tonar", domestic_shift), p3_curve(n$foreign, "sofr", foreign_shift),
                                        m$domestic, m$foreign, rho, PR_TIMES, rep(1, length(PR_TIMES)), n$reference_fx, n$leverage,
                                        n$leverage - n$fixed_coupon, n$floor, n$cap, notional = n$notional, second_order = second_order)
}
p3_npv <- function(...) p3_value(...)$summary$value

p3_bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
p3_is_correlation <- function(rho) det(matrix(c(1, rho[1], rho[2], rho[1], 1, rho[3], rho[2], rho[3], 1), 3)) > 1e-9

# The three correlations of a request: the list as given (with the defaults) and the vector (domestic-foreign, domestic-FX, foreign-FX).
p3_read_correlation <- function(body) {
  given <- body$correlation
  if (!is.null(given) && !is.list(given)) p3_bad("correlation must be an object")
  unknown <- setdiff(names(given), names(P3_DEFAULTS$correlation))
  if (length(unknown)) p3_bad(sprintf("unknown field correlation.%s", unknown[1]))
  c0 <- utils::modifyList(P3_DEFAULTS$correlation, if (is.null(given)) list() else given)
  for (k in names(c0)) {
    x <- c0[[k]]
    if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= -0.99 && x <= 0.99)) p3_bad(sprintf("correlation.%s は -0.99〜0.99 にしてください", k))
  }
  rho <- unlist(c0[c("domesticForeign", "domesticFx", "foreignFx")], use.names = FALSE)
  if (!p3_is_correlation(rho)) p3_bad("三つの相関が相関行列になっていません（組み合わせを変えてください）")
  list(inputs = c0, rho = rho)
}

prdc_three_factor_compute <- function(body = list()) {
  r0 <- p3_read_correlation(body); c0 <- r0$inputs; rho <- r0$rho
  m <- P3_MODEL; b <- P3_BUMP; S <- m$spot; sig <- m$fx_volatility

  # the second derivatives are rmql's (second_order = TRUE); an older rmql does not have the argument
  if (!"second_order" %in% names(formals(rmql::compute_prdc_three_factor_value))) stop("rmql の second_order（2階自動微分）が必要です。rmql を更新してください")
  base <- p3_value(S, sig, rho, second_order = TRUE)
  s <- base$sensitivity; at <- function(p) s$d_npv[s$parameter == p]
  cs <- base$curve_sensitivity

  # correlations: automatic differentiation against a central difference of the value (per +0.01 of the correlation)
  names_rho <- c("rho_domestic_foreign", "rho_domestic_fx", "rho_foreign_fx")
  labels_rho <- c("円金利 × 外貨金利", "円金利 × FX", "外貨金利 × FX")
  fd_rho <- vapply(1:3, \(i) {
    up <- rho; dn <- rho; up[i] <- up[i] + b$correlation; dn[i] <- dn[i] - b$correlation
    (p3_npv(S, sig, up) - p3_npv(S, sig, dn)) / (2 * b$correlation)
  }, 0)
  ad_rho <- vapply(names_rho, at, 0)
  correlation <- data.frame(pair = labels_rho, automatic_differentiation = ad_rho * 0.01, finite_difference = fd_rho * 0.01,
                            difference = (ad_rho - fd_rho) * 0.01)

  # Cross-gammas and Vanna. "automatic_differentiation": rmql's second-order automatic differentiation. "finite_difference":
  # four-point difference of the value alone.
  four_point <- function(f) { hs <- b$spot; (f(hs, 1) - f(hs, -1) - f(-hs, 1) + f(-hs, -1)) }
  d2 <- setNames(base$second_order$d2_npv, base$second_order$parameter_2)
  rate_fd <- function(side) {
    h <- b$rate
    four_point(\(ds, dr) if (side == "domestic") p3_npv(S + ds, sig, rho, domestic_shift = dr * h) else p3_npv(S + ds, sig, rho, foreign_shift = dr * h)) / (4 * b$spot * h)
  }
  vanna_fd <- four_point(\(ds, dv) p3_npv(S + ds, sig + dv * b$volatility, rho)) / (4 * b$spot * b$volatility)
  second <- data.frame(
    item = c("クロスガンマ：FXスポット × 円金利", "クロスガンマ：FXスポット × 外貨金利", "Vanna：FXスポット × FXボラティリティ"),
    unit = c("円／（FX 1円 × 1bp）", "円／（FX 1円 × 1bp）", "円／（FX 1円 × ボラ 1%）"),
    automatic_differentiation = c(d2[["domestic_curve_shift"]] * 1e-4, d2[["foreign_curve_shift"]] * 1e-4, d2[["fx_volatility"]] * 0.01),
    finite_difference = c(rate_fd("domestic") * 1e-4, rate_fd("foreign") * 1e-4, vanna_fd * 0.01))
  second$difference <- second$automatic_differentiation - second$finite_difference

  list(
    inputs = list(correlation = c0),
    npv = base$summary$value,
    greeks = list(fx_delta = at("spot"), fx_vega = at("fx_volatility"),
                  domestic_dv01 = sum(cs$npv_per_bp[cs$curve == "domestic"]), foreign_dv01 = sum(cs$npv_per_bp[cs$curve == "foreign"])),
    effective_volatility = base$coupons$effective_volatility,
    correlation = correlation,
    second_order = second,
    bumps = b,
    conventions = list(
      model = "3因子モデル（コールなし）：FX は対数正規、円と外貨の短期金利は Hull–White（平均回帰 3%・5%、ボラ 1%・1.2%）、相関は入力の三つ。閉じた式で評価する。想定元本 1億円、5年、年1回のクーポンは第15章の PRDC と同じ。",
      automatic_differentiation = "自動微分は rmql の1回の評価で、PV・デルタ・ベガ・三つの相関の微分を返す。相関は +0.01 あたりの円。",
      second_order = "クロスガンマと Vanna の「2階自動微分」は rmql の second_order = TRUE（デルタの微分を記録して、もう一度微分する）。「有限差分」は PV だけの4点差分である。金利は円（外貨）カーブのゼロ金利の平行シフト。",
      bump = "有限差分のバンプ幅：相関 0.001、スポット 0.015 円、ボラ 0.01%（絶対）、金利 0.1bp（安定する範囲の中で選んだ値）。2階自動微分にバンプ幅はない。",
      engine = paste("rmql", as.character(utils::packageVersion("rmql"))))
  )
}

# The graphs of the page: how the value moves with each correlation, and how the delta and the vega move with the rates and the
# volatility. Every point is one valuation of rmql's closed form. The tangents are drawn from rmql's automatic-differentiation
# derivatives at the current inputs: the first derivative for the correlations, and the cross second derivatives of
# second_order = TRUE for the delta against a parallel shift of each curve and the FX volatility, and for the vega against the spot
# (the two Vanna slopes are the same mixed derivative).
prdc_three_factor_scan <- function(body = list()) {
  if (!"second_order" %in% names(formals(rmql::compute_prdc_three_factor_value))) stop("rmql の second_order（2階自動微分）が必要です。rmql を更新してください")
  r0 <- p3_read_correlation(body); rho <- r0$rho
  m <- P3_MODEL; S <- m$spot; sig <- m$fx_volatility
  base <- p3_value(S, sig, rho, second_order = TRUE)
  first <- setNames(base$sensitivity$d_npv, base$sensitivity$parameter)
  d2 <- setNames(base$second_order$d2_npv, base$second_order$parameter_2)
  npv0 <- base$summary$value; delta0 <- first[["spot"]]; vega0 <- first[["fx_volatility"]]
  spot_delta <- function(...) { s <- p3_value(...)$sensitivity; s$d_npv[s$parameter == "spot"] }
  spot_vega <- function(...) { s <- p3_value(...)$sensitivity; s$d_npv[s$parameter == "fx_volatility"] }

  names_rho <- c("rho_domestic_foreign", "rho_domestic_fx", "rho_foreign_fx")
  labels_rho <- c("円金利 × 外貨金利", "円金利 × FX", "外貨金利 × FX")
  grid <- round(seq(-0.9, 0.9, by = 0.1), 2)
  correlation <- lapply(1:3, function(i) {
    ok <- vapply(grid, function(x) { rr <- rho; rr[i] <- x; p3_is_correlation(rr) }, TRUE)
    xs <- grid[ok]
    npv <- vapply(xs, function(x) { rr <- rho; rr[i] <- x; p3_npv(S, sig, rr) }, 0)
    list(pair = labels_rho[i], current = rho[i], npv = npv0, slope = first[[names_rho[i]]],
         points = data.frame(rho = xs, npv = npv, tangent = npv0 + first[[names_rho[i]]] * (xs - rho[i])))
  })

  shifts <- seq(-100, 100, by = 20)
  rate_scan <- function(side) {
    delta <- vapply(shifts, function(bp) if (side == "domestic") spot_delta(S, sig, rho, domestic_shift = bp * 1e-4) else spot_delta(S, sig, rho, foreign_shift = bp * 1e-4), 0)
    slope <- d2[[paste0(side, "_curve_shift")]] * 1e-4
    list(delta = delta0, slope_per_bp = slope, points = data.frame(shift_bp = shifts, delta = delta, tangent = delta0 + slope * shifts))
  }
  vols <- seq(4, 24, by = 2)
  vol_slope <- d2[["fx_volatility"]] * 0.01
  delta_by_vol <- list(delta = delta0, current = sig * 100, slope_per_point = vol_slope,
    points = data.frame(vol_pct = vols, delta = vapply(vols, function(v) spot_delta(S, v / 100, rho), 0),
                        tangent = delta0 + vol_slope * (vols - sig * 100)))
  spots <- seq(110, 190, by = 8)
  vega_by_spot <- list(vega = vega0 * 0.01, current = S, slope_per_yen = vol_slope,
    points = data.frame(spot = spots, vega = vapply(spots, function(s) spot_vega(s, sig, rho) * 0.01, 0),
                        tangent = vega0 * 0.01 + vol_slope * (spots - S)))
  list(
    inputs = r0$inputs, npv = npv0,
    correlation = correlation,
    cross_gamma = list(domestic = rate_scan("domestic"), foreign = rate_scan("foreign")),
    vanna = list(delta_by_vol = delta_by_vol, vega_by_spot = vega_by_spot),
    conventions = list(
      correlation = "各点は、その相関だけを動かして（ほかは入力のまま）閉じた式で評価した現在価値。点線は自動微分の1階微分による接線。三つが相関行列にならない相関の値は描かない。",
      cross_gamma = "各点は、円（外貨）カーブのゼロ金利を平行にシフトして評価した FX デルタ（自動微分）。点線は、シフトなしのデルタを通り、傾きが2階自動微分のクロスガンマ。",
      vanna = "左は FX ボラを動かして評価した FX デルタ、右はスポットを動かして評価した FX ベガ（ボラ 1 ポイントあたり）。どちらの点線も、傾きが2階自動微分の Vanna（同じ交差微分）。",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))))
}

# The scenario: the spot, the FX volatility and the two curves moved together. The profit and loss by full revaluation (rmql's closed
# form at the moved inputs), by the first-order approximation (the sum of delta, vega and the two DV01s times the moves, from automatic
# differentiation), and by the first-order approximation plus the three cross terms (the cross-gammas with each curve and the Vanna times
# the moves, from second_order = TRUE). The bars: each Greek's contribution, and the difference of each approximation from the full
# revaluation. The rest (pure gamma, volga, the cross terms between rates and with the volatility) is in the difference.
#
# POST /api/prdc-three-factor/scenario  {"correlation": {...}, "shock": {"spotYen": 5, "volPoints": 2, "domesticBp": 20, "foreignBp": -20}}
P3_SHOCK_DEFAULTS <- list(spotYen = 5, volPoints = 2, domesticBp = 20, foreignBp = -20)
P3_SHOCK_RANGES <- list(spotYen = c(-50, 50), volPoints = c(-8, 12), domesticBp = c(-200, 200), foreignBp = c(-200, 200))

p3_read_shock <- function(body) {
  given <- body$shock
  if (!is.null(given) && !is.list(given)) p3_bad("shock must be an object")
  unknown <- setdiff(names(given), names(P3_SHOCK_DEFAULTS))
  if (length(unknown)) p3_bad(sprintf("unknown field shock.%s", unknown[1]))
  s <- utils::modifyList(P3_SHOCK_DEFAULTS, if (is.null(given)) list() else given)
  for (k in names(P3_SHOCK_RANGES)) {
    x <- s[[k]]; lim <- P3_SHOCK_RANGES[[k]]
    if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= lim[1] && x <= lim[2])) p3_bad(sprintf("shock.%s は %s〜%s にしてください", k, lim[1], lim[2]))
  }
  s
}

# The Greeks at the base point: the value, the first derivatives and the DV01s (automatic differentiation), and the cross second
# derivatives with the spot (second_order = TRUE). They are asked of rmql once for a scenario or for a curve of scenarios.
p3_greeks <- function(rho) {
  if (!"second_order" %in% names(formals(rmql::compute_prdc_three_factor_value))) stop("rmql の second_order（2階自動微分）が必要です。rmql を更新してください")
  m <- P3_MODEL
  base <- p3_value(m$spot, m$fx_volatility, rho, second_order = TRUE)
  first <- setNames(base$sensitivity$d_npv, base$sensitivity$parameter)
  cs <- base$curve_sensitivity
  list(npv = base$summary$value, delta = first[["spot"]], vega = first[["fx_volatility"]],
       dv01 = c(domestic = sum(cs$npv_per_bp[cs$curve == "domestic"]), foreign = sum(cs$npv_per_bp[cs$curve == "foreign"])), # per +1bp of the parallel shift
       d2 = setNames(base$second_order$d2_npv, base$second_order$parameter_2))
}

# The profit and loss of one move: by full revaluation, by the first order, and by the first order plus the three cross terms.
p3_scenario_point <- function(g, rho, dS, dv, bd, bf) {
  m <- P3_MODEL
  moved <- p3_npv(m$spot + dS, m$fx_volatility + dv, rho, domestic_shift = bd * 1e-4, foreign_shift = bf * 1e-4)
  value <- c(g$delta * dS, g$vega * dv, g$dv01[["domestic"]] * bd, g$dv01[["foreign"]] * bf,
             g$d2[["domestic_curve_shift"]] * dS * bd * 1e-4, g$d2[["foreign_curve_shift"]] * dS * bf * 1e-4, g$d2[["fx_volatility"]] * dS * dv)
  full <- moved - g$npv; first_order <- sum(value[1:4]); with_cross <- sum(value)
  list(moved = moved, value = value, full = full, first_order = first_order, first_plus_cross = with_cross,
       difference_first_order = full - first_order, difference_first_plus_cross = full - with_cross)
}
P3_CONTRIBUTION_ITEMS <- data.frame(
  item = c("FX デルタ", "FX ベガ", "円金利 DV01", "外貨金利 DV01", "クロスガンマ（スポット × 円金利）", "クロスガンマ（スポット × 外貨金利）", "Vanna（スポット × ボラ）"),
  short = c("デルタ", "ベガ", "円DV01", "外貨DV01", "Γ×円金利", "Γ×外貨金利", "Vanna"),
  kind = c(rep("first", 4), rep("cross", 3)))

prdc_three_factor_scenario <- function(body = list()) {
  r0 <- p3_read_correlation(body); rho <- r0$rho
  sh <- p3_read_shock(body)
  m <- P3_MODEL; S <- m$spot; sig <- m$fx_volatility
  g <- p3_greeks(rho)
  pt <- p3_scenario_point(g, rho, sh$spotYen, sh$volPoints * 0.01, sh$domesticBp, sh$foreignBp)
  list(
    inputs = list(correlation = r0$inputs, shock = sh),
    base = list(spot = S, fx_volatility_pct = sig * 100, npv = g$npv),
    moved = list(spot = S + sh$spotYen, fx_volatility_pct = (sig + sh$volPoints * 0.01) * 100, domestic_shift_bp = sh$domesticBp, foreign_shift_bp = sh$foreignBp, npv = pt$moved),
    pnl = list(full = pt$full, first_order = pt$first_order, first_plus_cross = pt$first_plus_cross,
               difference_first_order = pt$difference_first_order, difference_first_plus_cross = pt$difference_first_plus_cross),
    contribution = cbind(P3_CONTRIBUTION_ITEMS, value = pt$value),
    conventions = list(
      full = "フル再評価：動かした入力（スポット、ボラ、両カーブのゼロ金利の平行シフト）で rmql の閉じた式をもう一度評価し、元の現在価値との差をとる。",
      first_order = "一次近似：FX デルタ × スポットの変化 ＋ FX ベガ × ボラの変化 ＋ 円・外貨の DV01 × 各金利のシフト（すべて rmql の自動微分）。",
      cross = "交差項：クロスガンマ（スポット × 円／外貨金利）× スポットの変化 × 金利のシフトと、Vanna × スポットの変化 × ボラの変化（rmql の second_order = TRUE）。",
      rest = "近似との差には、交差項に入れていない2階の項（スポットのガンマ、ボラの二階、金利どうし・金利とボラの交差、3次以上）が入る。",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))))
}

# The scenario against the spot: the ボラ and the two rates are moved as given, the spot over a grid, and every point is valued first, so that
# the page can show the numbers of a point at once while a line is dragged. The bubble scale is the largest cross contribution of the grid.
#
# POST /api/prdc-three-factor/scenario-curve  {"correlation": {...}, "shock": {"volPoints": 2, "domesticBp": 20, "foreignBp": -20}}
P3_SPOT_GRID <- seq(-40, 40, by = 1)
prdc_three_factor_scenario_curve <- function(body = list()) {
  r0 <- p3_read_correlation(body); rho <- r0$rho
  sh <- p3_read_shock(body)
  g <- p3_greeks(rho)
  rows <- lapply(P3_SPOT_GRID, function(dS) {
    pt <- p3_scenario_point(g, rho, dS, sh$volPoints * 0.01, sh$domesticBp, sh$foreignBp)
    list(spotYen = dS, full = pt$full, first_order = pt$first_order, first_plus_cross = pt$first_plus_cross,
         difference_first_order = pt$difference_first_order, difference_first_plus_cross = pt$difference_first_plus_cross,
         cross = list(domestic = pt$value[5], foreign = pt$value[6], vanna = pt$value[7]))
  })
  cross_abs <- vapply(rows, function(r) max(abs(unlist(r$cross))), 0)
  list(
    inputs = list(correlation = r0$inputs, shock = sh),
    points = rows,
    bubble_scale = max(cross_abs),
    conventions = list(
      curve = "各点は、スポットの変化だけを横軸の値にして、ボラと両金利は入力のまま再評価した損益。フル再評価は rmql の閉じた式、一次近似と交差項は rmql の自動微分。",
      bubble = "バブルの面積は交差項の寄与の絶対値、色はプラスとマイナス。縮尺は全点で同じ。",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))))
}

# The small example at the top of the scenario section: an unhedged foreign bond. The yen return is (1 + bond return) (1 + FX return) - 1,
# the sum of the bond, the FX and the cross term. No rmql call (the arithmetic of the return, not a valuation).
#
# POST /api/cross-term-example  {"bondPct": -2, "fxPct": 5}
cross_term_example <- function(body = list()) {
  given <- body
  unknown <- setdiff(names(given), c("bondPct", "fxPct"))
  if (length(unknown)) p3_bad(sprintf("unknown field %s", unknown[1]))
  x <- utils::modifyList(list(bondPct = -2, fxPct = 5), given)
  for (k in c("bondPct", "fxPct")) {
    v <- x[[k]]
    if (!(is.numeric(v) && length(v) == 1L && is.finite(v) && v >= -50 && v <= 50)) p3_bad(sprintf("%s は -50〜50 にしてください", k))
  }
  rb <- x$bondPct / 100; rf <- x$fxPct / 100
  list(
    inputs = x,
    steps = data.frame(item = c("債券", "為替", "交差項"), value_pt = c(x$bondPct, x$fxPct, 100 * rb * rf)),
    total_pct = 100 * ((1 + rb) * (1 + rf) - 1),
    conventions = list(
      return = "為替ヘッジなしの外債の円建てリターン ＝ (1 + 債券のリターン) × (1 + 為替の変化) − 1 ＝ 債券 ＋ 為替 ＋ 債券 × 為替（交差項）。単位はポイント（%）。")
  )
}
