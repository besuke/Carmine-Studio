# Part III in one page: the risk of a PRDC by automatic differentiation, in parallel and distributed (Coral-Book
# III-1 to III-7, on the note of III-7). All calculations are rmql (compute_prdc_value: the value and its
# derivatives by automatic differentiation, in closed form or by Monte Carlo on worker threads). Bump and revalue is the
# same function called again with each input moved. Reconciled in server/tests/reconciliation/prdc_risk/.
#
# POST /api/prdc-risk        {"market": {"spot": 150, "volPct": 12}, "mc": {"paths": 20000, "seed": 1234}, "threads": {"paths": 400000}}
# POST /api/prdc-risk/job    {"scenarios": [{"id": 1, "spot": 150, "volPct": 12}, ...]}   one job of the scenario grid
#
# The note (III-7.1): notional 100 million yen, five annual coupons min(8%, max(0, 2% + 80% (S / 150 - 1))), the
# redemption at the end; JPY and foreign rates of each year as in the manuscript, FX volatility 12%.

PR_DEFAULTS <- list(market = list(spot = 150, volPct = 12), mc = list(paths = 20000, seed = 1234), threads = list(paths = 400000))
PR_NOTE <- list(notional = 1e8, reference_fx = 150, fixed_coupon = 0.02, leverage = 0.8, cap = 0.08, floor = 0,
                years = 1:5, jpy = c(0.010, 0.012, 0.014, 0.016, 0.018), foreign = c(0.040, 0.038, 0.036, 0.034, 0.032))
PR_REF <- as.Date("2026-11-02")
PR_DATES <- PR_REF + round(365 * PR_NOTE$years)
PR_TIMES <- as.numeric(PR_DATES - PR_REF) / 365

# Each year's rate holds over that year: discount factors exp(-cumulative sum), log-linear between the year ends.
pr_curve <- function(rates, index, bump_node = 0L, bump = 0) {
  df <- exp(-cumsum(rates))
  if (bump_node > 0L) df[bump_node] <- df[bump_node] * exp(-bump * PR_TIMES[bump_node]) # +bump on that node's zero rate
  rmql::create_discount_curve(c(PR_REF, PR_DATES), c(1, df), "actual_365_fixed", index = index)
}
PR_CURVES <- list(domestic = pr_curve(PR_NOTE$jpy, "tonar"), foreign = pr_curve(PR_NOTE$foreign, "sofr"))

pr_value <- function(spot, vol, domestic = PR_CURVES$domestic, foreign = PR_CURVES$foreign, paths = 0, seed = 1, threads = 0L) {
  n <- PR_NOTE
  rmql::compute_prdc_value(spot, vol, domestic, foreign, PR_TIMES, rep(1, length(PR_TIMES)), n$reference_fx, n$leverage,
                                     n$leverage - n$fixed_coupon, n$floor, n$cap, notional = n$notional, paths = paths, seed = seed,
                                     threads = threads)
}
pr_time <- function(f) { t0 <- proc.time()[["elapsed"]]; v <- f(); list(value = v, seconds = proc.time()[["elapsed"]] - t0) }
# Repeat until 50 ms have passed (the clock ticks in steps of about 10 ms on Windows) and give the time of one run.
pr_time_repeat <- function(f) {
  v <- f(); reps <- 1L
  repeat {
    t0 <- proc.time()[["elapsed"]]
    for (i in seq_len(reps)) f()
    el <- proc.time()[["elapsed"]] - t0
    if (el >= 0.05 || reps >= 4096L) return(list(value = v, seconds = el / reps))
    reps <- reps * 2L
  }
}

# III-1.3 and III-4 to III-7: every sensitivity by automatic differentiation in one valuation, and by bump and revalue.
pr_ad_vs_bump <- function(spot, vol) {
  ad <- pr_time_repeat(\() pr_value(spot, vol))
  s <- ad$value$summary; cs <- ad$value$curve_sensitivity
  hs <- 1e-4 * spot; hv <- 1e-4; bp <- 1e-4
  bump <- pr_time_repeat(\() {
    fx <- (pr_value(spot + hs, vol)$summary$npv - pr_value(spot - hs, vol)$summary$npv) / (2 * hs)
    vg <- (pr_value(spot, vol + hv)$summary$npv - pr_value(spot, vol - hv)$summary$npv) / (2 * hv)
    nodes <- unlist(lapply(c("domestic", "foreign"), \(side) vapply(seq_along(PR_TIMES), \(k) {
      rates <- if (side == "domestic") PR_NOTE$jpy else PR_NOTE$foreign
      index <- if (side == "domestic") "tonar" else "sofr"
      v <- function(b) {
        c <- pr_curve(rates, index, k, b)
        if (side == "domestic") pr_value(spot, vol, domestic = c)$summary$npv else pr_value(spot, vol, foreign = c)$summary$npv
      }
      (v(bp) - v(-bp)) / 2
    }, 0)))
    c(fx, vg, nodes)
  })
  labels <- c("FX デルタ（円／FX 1円）", "FX ベガ（円／ボラ 1）", sprintf("円カーブ %d年（円／1bp）", PR_NOTE$years), sprintf("外貨カーブ %d年（円／1bp）", PR_NOTE$years))
  ad_values <- c(s$fx_delta, s$fx_vega, cs$npv_per_bp[cs$curve == "domestic"], cs$npv_per_bp[cs$curve == "foreign"])
  # the manuscript's definition (III-7): each year's rate r_j moves log DF_k for every node k >= j, so
  # dV/dr_j = -sum over k >= j of dV/dlogDF_k; per 1bp
  per_year <- function(side) {
    d <- cs$d_npv[cs$curve == side]
    -rev(cumsum(rev(d))) * 1e-4
  }
  list(
    npv = s$npv,
    per_year = data.frame(year = PR_NOTE$years, jpy_rate_per_bp = per_year("domestic"), foreign_rate_per_bp = per_year("foreign")),
    table = data.frame(factor = labels, automatic_differentiation = ad_values, bump_and_revalue = bump$value, difference = ad_values - bump$value),
    evaluations = list(automatic_differentiation = 1L, bump_and_revalue = 2L * length(labels)),
    seconds = list(automatic_differentiation = ad$seconds, bump_and_revalue = bump$seconds)
  )
}

PR_CACHE <- new.env(parent = emptyenv())
pr_memo <- function(name, inputs, f) {
  key <- paste(name, paste(format(unlist(inputs), digits = 17), collapse = "|"))
  if (is.null(PR_CACHE[[key]])) assign(key, f(), envir = PR_CACHE)
  PR_CACHE[[key]]
}

# III-1 and III-7.5: the Monte Carlo on 1, 2, 4 and 8 threads; the value depends on the seed, not on the threads.
pr_threads <- function(spot, vol, paths) pr_memo("threads", list(spot, vol, paths), function() {
  rows <- lapply(c(1L, 2L, 4L, 8L), \(th) {
    r <- pr_time(\() pr_value(spot, vol, paths = paths, seed = 1234, threads = th)$summary)
    data.frame(threads = th, seconds = r$seconds, npv = r$value$npv, fx_delta = r$value$fx_delta, standard_error = r$value$standard_error)
  })
  out <- do.call(rbind, rows)
  out$speedup <- out$seconds[1] / pmax(out$seconds, 1e-3)
  out$difference_from_one_thread <- out$npv - out$npv[1]
  out
})

prdc_risk_compute <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  read <- function(section, ranges) {
    given <- body[[section]]
    if (!is.null(given) && !is.list(given)) bad(sprintf("%s must be an object", section))
    unknown <- setdiff(names(given), names(PR_DEFAULTS[[section]]))
    if (length(unknown)) bad(sprintf("unknown field %s.%s", section, unknown[1]))
    p <- utils::modifyList(PR_DEFAULTS[[section]], if (is.null(given)) list() else given)
    for (k in names(ranges)) {
      x <- p[[k]]; lim <- ranges[[k]]
      if (!(is.numeric(x) && length(x) == 1L && is.finite(x) && x >= lim[1] && x <= lim[2])) bad(sprintf("%s.%s は %s〜%s にしてください", section, k, lim[1], lim[2]))
    }
    p
  }
  m <- read("market", list(spot = c(50, 300), volPct = c(1, 60)))
  mc <- read("mc", list(paths = c(1000, 200000), seed = c(1, 1e9)))
  th <- read("threads", list(paths = c(10000, 1000000)))
  vol <- m$volPct / 100
  mcv <- pr_value(m$spot, vol, paths = mc$paths, seed = mc$seed)
  list(
    inputs = list(market = m, mc = mc, threads = th),
    note = c(PR_NOTE[c("notional", "reference_fx", "fixed_coupon", "leverage", "cap", "floor")],
             list(curve = data.frame(year = PR_NOTE$years, date = format(PR_DATES), jpy_rate = PR_NOTE$jpy, foreign_rate = PR_NOTE$foreign))),
    payoff = data.frame(fx = seq(100, 220, by = 2)) |>
      transform(coupon = pmin(PR_NOTE$cap, pmax(PR_NOTE$floor, PR_NOTE$fixed_coupon + PR_NOTE$leverage * (seq(100, 220, by = 2) / PR_NOTE$reference_fx - 1)))),
    machine = list(logical_processors = parallel::detectCores(logical = TRUE)),
    conventions = list(
      note = "想定元本 1億円、5年、年1回のクーポン min(8%, max(0, 2% + 80% × (S / 150 − 1)))、満期に元本を償還。各年の円金利と外貨金利は原稿 III-7.1 の値（その年のあいだ一定）",
      ad = "自動微分は1回の評価で全部の感応度を返す。Bump & Revalue は同じ評価関数を、各入力を上下に動かして呼び直す（中心差分）。カーブの感応度はその年の節点のゼロ金利 +1bp あたり",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))),
    ad = pr_ad_vs_bump(m$spot, vol),
    mc = list(paths = mc$paths, seed = mc$seed, npv = mcv$summary$npv, standard_error = mcv$summary$standard_error,
              fx_delta = mcv$summary$fx_delta, fx_vega = mcv$summary$fx_vega,
              curve = data.frame(curve = mcv$curve_sensitivity$curve, year = rep(PR_NOTE$years, 2), npv_per_bp = mcv$curve_sensitivity$npv_per_bp)),
    threads = list(paths = th$paths, table = pr_threads(m$spot, vol, as.integer(th$paths)))
  )
}

# One job of the distributed grid: each scenario valued once, with its delta and vega by automatic differentiation.
prdc_risk_job <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  sc <- body$scenarios
  if (!is.data.frame(sc) || !nrow(sc) || !all(c("id", "spot", "volPct") %in% names(sc))) bad("scenarios は id・spot・volPct を持つ配列にしてください")
  if (nrow(sc) > 200) bad("1つのジョブのシナリオは 200 件までにしてください")
  if (any(!is.finite(sc$spot) | sc$spot < 50 | sc$spot > 300 | !is.finite(sc$volPct) | sc$volPct < 1 | sc$volPct > 60)) bad("spot は 50〜300、volPct は 1〜60 にしてください")
  t0 <- proc.time()[["elapsed"]]
  rows <- lapply(seq_len(nrow(sc)), \(i) {
    s <- pr_value(sc$spot[i], sc$volPct[i] / 100)$summary
    data.frame(id = sc$id[i], spot = sc$spot[i], volPct = sc$volPct[i], npv = s$npv, fx_delta = s$fx_delta, fx_vega = s$fx_vega)
  })
  list(results = do.call(rbind, rows), server_seconds = proc.time()[["elapsed"]] - t0, worker = paste0("R API pid ", Sys.getpid()))
}
