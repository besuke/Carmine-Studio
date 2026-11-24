# Chapter 15: how the finite difference depends on the bump width. Automatic differentiation has no bump; the finite difference
# is right only inside a range of widths (the truncation error on the large side, the round-off on the small side).
# Needs p3_* of prdc_three_factor_model.R.

P3_BUMP_STUDY_MULTIPLIERS <- 10^seq(-3, 3, by = 0.5)

prdc_bump_study <- function(body = list()) {
  r0 <- p3_read_correlation(body); rho <- r0$rho
  m <- P3_MODEL; b <- P3_BUMP; S <- m$spot; sig <- m$fx_volatility
  base <- p3_value(S, sig, rho, second_order = "full")
  s <- base$sensitivity; at <- function(p) s$d_npv[s$parameter == p]
  d2 <- p3_pairs(base$second_order)
  v0 <- p3_npv(S, sig, rho)
  value_at <- function(x) p3_npv(S + x[1], sig + x[2], rho, domestic_shift = x[3], foreign_shift = x[4])
  e <- function(i, h) { x <- c(0, 0, 0, 0); x[i] <- h; x }
  three <- function(i, h) (value_at(e(i, h)) - 2 * v0 + value_at(e(i, -h))) / h^2
  four <- function(i, hi, j, hj) (value_at(e(i, hi) + e(j, hj)) - value_at(e(i, hi) - e(j, hj)) - value_at(-e(i, hi) + e(j, hj)) + value_at(-e(i, hi) - e(j, hj))) / (4 * hi * hj)
  nm <- c("spot", "fx_volatility", "domestic_curve_shift", "foreign_curve_shift")
  ad2 <- function(i, j) p3_h(d2, nm[i], nm[j])
  rho_fd <- function(h) { up <- rho; dn <- rho; up[2] <- up[2] + h; dn[2] <- dn[2] - h; (p3_npv(S, sig, up) - p3_npv(S, sig, dn)) / (2 * h) }

  targets <- list(
    list(key = "rho", label = "相関感応度（円金利 × FX）", base = b$correlation, unit = "相関の幅", ad = at("rho_domestic_fx"), fd = rho_fd),
    list(key = "gamma", label = "ガンマ（スポット × スポット）", base = b$spot, unit = "スポットの幅（円）", ad = ad2(1, 1), fd = function(h) three(1, h)),
    list(key = "vanna", label = "Vanna（スポット × ボラ）", base = b$volatility, unit = "ボラの幅（絶対）", ad = ad2(1, 2),
         fd = function(h) four(1, b$spot, 2, h)),
    list(key = "rate2", label = "円金利の2階", base = b$rate2, unit = "金利の幅", ad = ad2(3, 3), fd = function(h) three(3, h)),
    list(key = "rate_vol", label = "円金利 × FX ボラ", base = b$rate, unit = "金利の幅", ad = ad2(3, 2), fd = function(h) four(3, h, 2, b$volatility)))

  lapply(targets, function(t) {
    h <- t$base * P3_BUMP_STUDY_MULTIPLIERS
    # a width that leaves the valid range (a correlation beyond 1, for instance) has no value
    fd <- vapply(h, function(x) tryCatch(t$fd(x), error = function(e) NA_real_), 0)
    ok <- is.finite(fd)
    list(key = t$key, label = t$label, unit = t$unit, automatic_differentiation = t$ad, chosen_width = t$base,
         points = data.frame(multiplier = P3_BUMP_STUDY_MULTIPLIERS[ok], width = h[ok], finite_difference = fd[ok],
                             relative_error = abs(fd[ok] - t$ad) / abs(t$ad)))
  }) -> studies
  list(
    inputs = list(correlation = r0$inputs),
    studies = studies,
    conventions = list(
      note = "横軸は、画面の有限差分で使う幅（倍率 1）に対する倍率。縦軸は、自動微分の値に対する有限差分の相対誤差。幅が大きいと打切り誤差、小さいと丸め誤差が効く。自動微分は幅を持たず、誤差は 0 の線。",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))))
}

# Chapter 15: what the ten second derivatives cost. Automatic differentiation: one call of rmql (second_order = "full") returns all ten.
# Finite differences: PV only; a same-variable second derivative takes 2 more valuations (three points, the base value is shared) and a
# cross takes 4 (four points). The times are measured here: the median of `reps` runs of each way, in milliseconds.
prdc_derivative_cost <- function(body = list(), reps = 15L) {
  r0 <- p3_read_correlation(body); rho <- r0$rho
  S <- P3_MODEL$spot; sig <- P3_MODEL$fx_volatility
  # the clock ticks at 10 ms on Windows: each sample repeats the work `inner` times
  timed <- function(f, inner = 20L) { f(); median(vapply(seq_len(reps), function(i) { t <- proc.time()[["elapsed"]]; for (k in seq_len(inner)) f(); (proc.time()[["elapsed"]] - t) * 1000 / inner }, 0)) }
  ad_ms <- timed(function() p3_value(S, sig, rho, second_order = "full"))
  value_ms <- timed(function() p3_npv(S, sig, rho))
  items <- data.frame(
    item = c("ガンマ（スポット × スポット）", "ボルガ（ボラ × ボラ）", "円金利の2階", "外貨金利の2階",
             "クロスガンマ（スポット × 円金利）", "クロスガンマ（スポット × 外貨金利）", "Vanna（スポット × ボラ）",
             "円金利 × 外貨金利", "円金利 × ボラ", "外貨金利 × ボラ"),
    finite_difference_valuations = c(2L, 2L, 2L, 2L, 4L, 4L, 4L, 4L, 4L, 4L))
  # the base value is shared: 1 + the sum
  fd_valuations <- 1L + sum(items$finite_difference_valuations)
  fd_ms <- timed(function() {
    v0 <- p3_npv(S, sig, rho)
    for (n in items$finite_difference_valuations) for (k in seq_len(n)) p3_npv(S + k * 1e-3, sig, rho)
  }, inner = 5L)
  list(
    inputs = list(correlation = r0$inputs),
    items = items,
    automatic_differentiation = list(calls = 1L, valuations = 1L, milliseconds = ad_ms),
    finite_difference = list(valuations = fd_valuations, milliseconds = fd_ms),
    single_valuation_ms = value_ms,
    ratio = list(valuations = fd_valuations / 1, time = fd_ms / ad_ms),
    reps = reps,
    conventions = list(
      note = "自動微分は rmql の1回の呼び出しで、価値・1階・10要素の2階を返す。有限差分は価値だけを再評価する：同じ変数の2階は2回、交差は4回、基準の価値1回を共有して合計 33 回。時間は本サーバーでの実測（中央値、ミリ秒）で、環境によって変わる。",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))))
}
