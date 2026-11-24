# Chapter II-9's PRDC: the scenario P&L with the cross terms and the second-order approximation, as chapter 15 has for the three-factor
# model. The note of II-9 has deterministic rates (the FX drifts at domestic minus foreign, the cash flows are discounted at the discount
# rate), which is rmql's three-factor closed form with no rate volatility (rmql docs/spec_prdc.md, chapter 5), so the second derivatives are
# rmql's second_order = "full" with the rate volatilities zero. Needs prdc_model.R (the schedule and the note) and
# prdc_three_factor_model.R (p3_pairs, p3_h), loaded before this file.
#
# POST /api/prdc/scenario  {"note": {...as /api/prdc...}, "shock": {"spotYen": 5, "volPoints": 2, "domesticBp": 20, "foreignBp": -20, "discountBp": 20}}
#
# The four variables of the Taylor expansion are the spot (yen), the FX volatility, the drift d = (domestic rate change - foreign rate
# change) and the discount rate change z. A change of the domestic rate by x, the foreign rate by y and the discount rate by z moves
# rmql's domestic (discount) curve by z and the foreign curve by z - (x - y). The table of second derivatives is rmql's, among the spot, the
# volatility and the two curves' shifts; it is carried to these four variables by that linear map (H' = J' H J, g' = J' g).

PRDC_SHOCK_DEFAULTS <- list(spotYen = 5, volPoints = 2, domesticBp = 20, foreignBp = -20, discountBp = 20)
PRDC_SHOCK_RANGES <- list(spotYen = c(-40, 40), volPoints = c(-8, 12), domesticBp = c(-200, 200), foreignBp = c(-200, 200), discountBp = c(-200, 200))

ps_read <- function(body) {
  note <- body$note
  if (!is.null(note) && !is.list(note)) p3_bad("note must be an object")
  unknown <- setdiff(names(note), names(PRDC_DEFAULTS$note))
  if (length(unknown)) p3_bad(sprintf("unknown field note.%s", unknown[1]))
  p <- utils::modifyList(PRDC_DEFAULTS$note, if (is.null(note)) list() else note)
  for (k in names(PRDC_NOTE_RANGES)) {
    x <- p[[k]]; lim <- PRDC_NOTE_RANGES[[k]]
    if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= lim[1] && x <= lim[2])) p3_bad(sprintf("note.%s must be within %s and %s", k, lim[1], lim[2]))
  }
  if (p$capPct <= p$floorPct) p3_bad("キャップはフロアより大きくしてください")
  given <- body$shock
  if (!is.null(given) && !is.list(given)) p3_bad("shock must be an object")
  unknown <- setdiff(names(given), names(PRDC_SHOCK_DEFAULTS))
  if (length(unknown)) p3_bad(sprintf("unknown field shock.%s", unknown[1]))
  sh <- utils::modifyList(PRDC_SHOCK_DEFAULTS, if (is.null(given)) list() else given)
  for (k in names(PRDC_SHOCK_RANGES)) {
    x <- sh[[k]]; lim <- PRDC_SHOCK_RANGES[[k]]
    if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= lim[1] && x <= lim[2])) p3_bad(sprintf("shock.%s は %s〜%s にしてください", k, lim[1], lim[2]))
  }
  if (p$spot + sh$spotYen < 1) p3_bad("動かしたスポットが 1 円未満になります")
  if (p$volPct + sh$volPoints < 0.5) p3_bad("動かしたボラが 0.5% 未満になります")
  list(note = p, shock = sh)
}

# The two curves of rmql for the note, as discount curves on the coupon dates (flat rates; nodes, so that the first derivatives are there),
# the domestic one at the discount rate and the foreign one at the discount rate minus the drift; shifted by dshift and fshift (decimals).
ps_curves <- function(p, dshift = 0, fshift = 0) {
  s <- PRDC_SCHEDULE
  drift <- (p$domesticPct - p$foreignPct) / 100
  dates <- c(PRDC_DATES$valuation, s$dates)
  make <- function(rate, index) rmql::create_discount_curve(dates, exp(-rate * c(0, s$times)), "actual_360", index = index)
  list(domestic = make(p$discountPct / 100 + dshift, "tonar"), foreign = make(p$discountPct / 100 - drift + fshift, "sofr"))
}
ps_value <- function(p, spot, vol, dshift = 0, fshift = 0, second_order = FALSE) {
  cv <- ps_curves(p, dshift, fshift); s <- PRDC_SCHEDULE
  rmql::compute_prdc_three_factor_value(spot, vol, cv$domestic, cv$foreign, c(0.03, 0), c(0.05, 0), c(0, 0, 0), s$times, s$accruals, p$fxBase,
                                        p$leveragePct / 100, p$subtractionPct / 100, p$floorPct / 100, p$capPct / 100, notional = PRDC_NOTIONAL,
                                        second_order = second_order)
}

PS_CONTRIBUTION_ITEMS <- data.frame(
  item = c("FX デルタ", "FX ベガ", "金利差（国内 − 外貨）の DV01", "割引金利の DV01", "クロスガンマ（スポット × 金利差）", "クロスガンマ（スポット × 割引金利）", "Vanna（スポット × ボラ）",
           "ガンマ（スポット × スポット）", "ボルガ（ボラ × ボラ）", "金利差の2階", "割引金利の2階", "金利差 × 割引金利", "金利差 × ボラ", "割引金利 × ボラ"),
  short = c("デルタ", "ベガ", "金利差DV01", "割引DV01", "Γ×金利差", "Γ×割引", "Vanna", "ガンマ", "ボルガ", "金利差2階", "割引2階", "差×割引", "差×ボラ", "割引×ボラ"),
  kind = c(rep("first", 4), rep("cross", 3), rep("second", 7)))

prdc_scenario <- function(body = list()) {
  if (!"second_order" %in% names(formals(rmql::compute_prdc_three_factor_value))) stop("rmql の second_order（2階自動微分）が必要です。rmql を更新してください")
  r <- ps_read(body); p <- r$note; sh <- r$shock
  vol <- p$volPct / 100
  # the moves in the four variables: yen, the volatility, the drift and the discount rate in decimals
  u <- c(sh$spotYen, sh$volPoints * 0.01, (sh$domesticBp - sh$foreignBp) * 1e-4, sh$discountBp * 1e-4)
  base <- ps_value(p, p$spot, vol, second_order = "full")
  sens <- setNames(base$sensitivity$d_npv, base$sensitivity$parameter)
  cs <- base$curve_sensitivity
  # first derivatives with respect to rmql's four variables (spot, volatility, domestic shift, foreign shift), the shifts per decimal
  gv <- c(sens[["spot"]], sens[["fx_volatility"]], sum(cs$npv_per_bp[cs$curve == "domestic"]) * 1e4, sum(cs$npv_per_bp[cs$curve == "foreign"]) * 1e4)
  d2 <- p3_pairs(base$second_order)
  nm <- c("spot", "fx_volatility", "domestic_curve_shift", "foreign_curve_shift")
  Hv <- outer(1:4, 1:4, Vectorize(function(i, j) p3_h(d2, nm[i], nm[j])))
  # the map from (spot, volatility, drift, discount) to (spot, volatility, domestic shift, foreign shift): domestic = z, foreign = z - d
  J <- matrix(c(1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 0, 1,  0, 0, -1, 1), 4, byrow = TRUE)
  g <- as.vector(t(J) %*% gv); H <- t(J) %*% Hv %*% J
  value <- c(g[1] * u[1], g[2] * u[2], g[3] * u[3], g[4] * u[4],
             H[1, 3] * u[1] * u[3], H[1, 4] * u[1] * u[4], H[1, 2] * u[1] * u[2],
             0.5 * H[1, 1] * u[1]^2, 0.5 * H[2, 2] * u[2]^2, 0.5 * H[3, 3] * u[3]^2, 0.5 * H[4, 4] * u[4]^2,
             H[3, 4] * u[3] * u[4], H[2, 3] * u[2] * u[3], H[2, 4] * u[2] * u[4])
  moved <- ps_value(p, p$spot + u[1], vol + u[2], dshift = u[4], fshift = u[4] - u[3])$summary$value
  full <- moved - base$summary$value
  first_order <- sum(value[1:4]); with_cross <- sum(value[1:7]); second_order <- sum(value)
  list(
    inputs = list(note = p, shock = sh),
    base = list(spot = p$spot, fx_volatility_pct = p$volPct, npv = base$summary$value),
    moved = list(spot = p$spot + u[1], fx_volatility_pct = (vol + u[2]) * 100, domestic_shift_bp = sh$domesticBp, foreign_shift_bp = sh$foreignBp, discount_shift_bp = sh$discountBp, npv = moved),
    pnl = list(full = full, first_order = first_order, first_plus_cross = with_cross, second_order = second_order,
               difference_first_order = full - first_order, difference_first_plus_cross = full - with_cross, difference_second_order = full - second_order),
    contribution = cbind(PS_CONTRIBUTION_ITEMS, value = value),
    conventions = list(
      model = "第II-9章のノートは金利が確定的（FX のドリフトは国内金利 − 外国金利、割引は割引金利）。rmql の3因子の閉じた式で金利のボラをゼロにしたものに等しく、2階微分は rmql の second_order = 'full'。",
      full = "フル再評価：動かした入力（スポット、ボラ、国内・外貨・割引金利）でノートをもう一度評価し、元の現在価値との差をとる。",
      first_order = "一次近似：FX デルタ × スポットの変化 ＋ FX ベガ × ボラの変化 ＋ 金利差（国内 − 外貨）の DV01 × 金利差の変化 ＋ 割引金利の DV01 × 割引金利の変化。",
      cross = "交差項：クロスガンマ（スポット × 金利差、スポット × 割引金利）と Vanna（スポット × ボラ）に、変化の積を掛けたもの。",
      second = "2階のその他の項：ガンマ、ボルガ、金利差の2階、割引金利の2階、金利差 × 割引金利、金利差 × ボラ、割引金利 × ボラ。一次近似＋交差項3つ＋これら7つが2次近似。",
      rest = "2次近似とフル再評価の差は、3次以上の項。",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))))
}
