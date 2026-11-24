# Chapter 15 (extension): the sensitivities of the three-factor PRDC without a call, by automatic differentiation and by
# finite differences, side by side. The note is the one of prdc_risk_model.R (five annual coupons, notional 100 million
# yen); the model is rmql's three-factor model (FX lognormal, Hull-White domestic and foreign short rates, three
# correlations), valued in closed form. See rmql docs/spec_prdc.md, sections 5 and 7.
#
# POST /api/prdc-three-factor   {"correlation": {"domesticForeign": 0.3, "domesticFx": -0.2, "foreignFx": 0.4}}
#
# Automatic differentiation (rmql, one valuation): the value, the spot delta, the FX vega and the three correlations.
# rmql has no second derivative, so the cross-gammas and the Vanna are central differences of the automatic-differentiation
# delta (one automatic-differentiation valuation per bump) and, for comparison, four-point differences of the value alone.
# Bump widths are in P3_BUMP; they are meant to be tuned.
#
# Needs prdc_risk_model.R (PR_NOTE, PR_TIMES, PR_REF, PR_DATES), loaded before this file.

P3_DEFAULTS <- list(correlation = list(domesticForeign = 0.3, domesticFx = -0.2, foreignFx = 0.4))
P3_MODEL <- list(spot = 150, fx_volatility = 0.12, domestic = c(mean_reversion = 0.03, volatility = 0.01),
                 foreign = c(mean_reversion = 0.05, volatility = 0.012))
# relative or absolute widths of the finite differences
P3_BUMP <- list(correlation = 1e-3, spot = 1e-3 * 150, volatility = 5e-4, rate = 1e-4)

p3_curve <- function(rates, index, shift = 0) {
  df <- exp(-cumsum(rates)) * exp(-shift * PR_TIMES) # a parallel shift of the continuous zero rates
  rmql::create_discount_curve(c(PR_REF, PR_DATES), c(1, df), "actual_365_fixed", index = index)
}

p3_value <- function(spot, vol, rho, domestic_shift = 0, foreign_shift = 0) {
  n <- PR_NOTE; m <- P3_MODEL
  rmql::compute_prdc_three_factor_value(spot, vol, p3_curve(n$jpy, "tonar", domestic_shift), p3_curve(n$foreign, "sofr", foreign_shift),
                                        m$domestic, m$foreign, rho, PR_TIMES, rep(1, length(PR_TIMES)), n$reference_fx, n$leverage,
                                        n$leverage - n$fixed_coupon, n$floor, n$cap, notional = n$notional)
}
p3_npv <- function(...) p3_value(...)$summary$value
p3_delta <- function(...) { s <- p3_value(...)$sensitivity; s$d_npv[s$parameter == "spot"] }

prdc_three_factor_compute <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  given <- body$correlation
  if (!is.null(given) && !is.list(given)) bad("correlation must be an object")
  unknown <- setdiff(names(given), names(P3_DEFAULTS$correlation))
  if (length(unknown)) bad(sprintf("unknown field correlation.%s", unknown[1]))
  c0 <- utils::modifyList(P3_DEFAULTS$correlation, if (is.null(given)) list() else given)
  for (k in names(c0)) {
    x <- c0[[k]]
    if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= -0.99 && x <= 0.99)) bad(sprintf("correlation.%s は -0.99〜0.99 にしてください", k))
  }
  rho <- unlist(c0[c("domesticForeign", "domesticFx", "foreignFx")], use.names = FALSE)
  # the three correlations must make a correlation matrix
  if (det(matrix(c(1, rho[1], rho[2], rho[1], 1, rho[3], rho[2], rho[3], 1), 3)) <= 1e-9)
    bad("三つの相関が相関行列になっていません（組み合わせを変えてください）")
  m <- P3_MODEL; b <- P3_BUMP; S <- m$spot; sig <- m$fx_volatility

  base <- p3_value(S, sig, rho)
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

  # Cross-gammas and Vanna. "automatic_differentiation": central difference of the AD delta. "finite_difference": four-point
  # difference of the value alone.
  four_point <- function(f) { hs <- b$spot; (f(hs, 1) - f(hs, -1) - f(-hs, 1) + f(-hs, -1)) }
  rate_ad <- function(side) {
    h <- b$rate
    d <- \(sh) if (side == "domestic") p3_delta(S, sig, rho, domestic_shift = sh) else p3_delta(S, sig, rho, foreign_shift = sh)
    (d(h) - d(-h)) / (2 * h)
  }
  rate_fd <- function(side) {
    h <- b$rate
    four_point(\(ds, dr) if (side == "domestic") p3_npv(S + ds, sig, rho, domestic_shift = dr * h) else p3_npv(S + ds, sig, rho, foreign_shift = dr * h)) / (4 * b$spot * h)
  }
  vanna_ad <- (p3_delta(S, sig + b$volatility, rho) - p3_delta(S, sig - b$volatility, rho)) / (2 * b$volatility)
  vanna_fd <- four_point(\(ds, dv) p3_npv(S + ds, sig + dv * b$volatility, rho)) / (4 * b$spot * b$volatility)
  second <- data.frame(
    item = c("クロスガンマ：FXスポット × 円金利", "クロスガンマ：FXスポット × 外貨金利", "Vanna：FXスポット × FXボラティリティ"),
    unit = c("円／（FX 1円 × 1bp）", "円／（FX 1円 × 1bp）", "円／（FX 1円 × ボラ 1%）"),
    automatic_differentiation = c(rate_ad("domestic") * 1e-4, rate_ad("foreign") * 1e-4, vanna_ad * 0.01),
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
      second_order = "rmql に2階微分はないので、クロスガンマと Vanna の「自動微分」は、自動微分のデルタの中心差分である。「有限差分」は PV だけの4点差分である。金利は円（外貨）カーブのゼロ金利の平行シフト。",
      bump = "バンプ幅：相関 0.001、スポット 0.15 円、ボラ 0.05%（絶対）、金利 1bp。調整の対象。",
      engine = paste("rmql", as.character(utils::packageVersion("rmql"))))
  )
}
