# Computational evolution and parallel computing (Coral-Book III-1). The chapter's worked example (present values
# of six scenarios, applied row by row) is the manuscript's R; the measurement of parallel valuation is rmql's
# batch of bonds on worker threads (compute_bond_values_batch), whose results do not depend on the number of threads.
#
# POST /api/parallel
#   {"batch": {"count": 10000, "maxThreads": 8}}
# The page asks for a measurement when the reader changes the count or the threads.

PAR_DEFAULTS <- list(batch = list(count = 10000, maxThreads = 8))
PAR_CORES <- parallel::detectCores(logical = TRUE)

# III-1.4: the manuscript's task and data; each row is an independent task.
par_present_value <- function(cashflow, discount_rate, maturity) {
  tibble::tibble(cashflow = cashflow, discount_rate = discount_rate, maturity = maturity,
                 present_value = cashflow / (1 + discount_rate)^maturity)
}
PAR_SCENARIOS <- tibble::tribble(
  ~scenario_ID, ~cashflow, ~discount_rate, ~maturity,
  1L, 100, 0.010, 1,
  2L, 100, 0.015, 2,
  3L, 100, 0.020, 3,
  4L, 100, 0.025, 4,
  5L, 100, 0.030, 5,
  6L, 100, 0.035, 6
)
par_example <- function() {
  PAR_SCENARIOS |>
    dplyr::mutate(result = purrr::pmap(list(cashflow, discount_rate, maturity), par_present_value)) |>
    dplyr::select(scenario_ID, result) |>
    tidyr::unnest(result)
}

# III-1.5–1.6: the same bond valued at `count` yields, on 1, 2, 4, ... threads.
par_bonds <- function(count) {
  data.frame(settlement_days = 2L, face_amount = 100, effective_date = as.Date("2026-03-20"), termination_date = as.Date("2036-03-20"),
             tenor = "6M", calendar = "japan", convention = "unadjusted", termination_convention = "unadjusted", rule = "backward",
             end_of_month = FALSE, coupon_rate = 0.015, day_count = "actual_365_fixed", payment_convention = "following", redemption = 100,
             issue_date = as.Date("2026-03-20"), rate = seq(0.001, 0.03, length.out = count), yield_day_count = "actual_365_fixed",
             compounding = "compounded", frequency = 2L, evaluation_date = as.Date("2026-11-02"))
}
par_measure <- function(p) {
  bonds <- par_bonds(as.integer(p$count))
  threads <- unique(pmin(c(1L, 2L, 4L, 8L, 16L), as.integer(p$maxThreads)))
  base <- NULL
  rows <- lapply(threads, \(th) {
    t0 <- proc.time()[["elapsed"]]
    r <- rmql::compute_bond_values_batch(bonds, threads = th)
    elapsed <- proc.time()[["elapsed"]] - t0
    if (is.null(base)) base <<- r
    cols <- c("clean_price", "dirty_price", "accrued_amount", "duration_modified", "convexity", "basis_point_value")
    data.frame(threads = th, seconds = elapsed, bonds_per_second = nrow(bonds) / max(elapsed, 1e-3),
               max_abs_diff_from_one_thread = max(vapply(cols, \(k) max(abs(r[[k]] - base[[k]])), 0)),
               errors = sum(!is.na(r$error)))
  })
  timing <- do.call(rbind, rows)
  timing$speedup <- timing$seconds[1] / pmax(timing$seconds, 1e-3)
  sample_rows <- unique(round(seq(1, nrow(bonds), length.out = 6)))
  list(count = nrow(bonds), timing = timing,
       sample = data.frame(yield = bonds$rate[sample_rows], clean_price = base$clean_price[sample_rows],
                           duration_modified = base$duration_modified[sample_rows], basis_point_value = base$basis_point_value[sample_rows]),
       price_by_yield = data.frame(yield = bonds$rate[unique(round(seq(1, nrow(bonds), length.out = 60)))],
                                   clean_price = base$clean_price[unique(round(seq(1, nrow(bonds), length.out = 60)))]))
}

parallel_compute <- function(body = list()) {
  bad <- function(msg) stop(structure(class = c("tona_bad_request", "error", "condition"), list(message = msg, call = NULL)))
  given <- body$batch
  if (!is.null(given) && !is.list(given)) bad("batch must be an object")
  unknown <- setdiff(names(given), names(PAR_DEFAULTS$batch))
  if (length(unknown)) bad(sprintf("unknown field batch.%s", unknown[1]))
  p <- utils::modifyList(PAR_DEFAULTS$batch, if (is.null(given)) list() else given)
  if (!(is.numeric(p$count) && length(p$count) == 1L && p$count >= 10 && p$count <= 20000)) bad("件数は 10〜20,000 にしてください")
  if (!(is.numeric(p$maxThreads) && length(p$maxThreads) == 1L && p$maxThreads >= 1 && p$maxThreads <= 16)) bad("スレッド数は 1〜16 にしてください")
  list(
    inputs = list(batch = p),
    machine = list(logical_processors = PAR_CORES, r_version = R.version.string),
    conventions = list(
      example = "原稿の III-1.4 の6シナリオ。各行が独立したタスクで、purrr::pmap で1行ずつ評価する",
      batch = "残存約10年の固定利付債（クーポン 1.5%、半年払い、Japan カレンダー）を、0.1%〜3% の複利利回りで件数分だけ評価する。スレッドは計算のあいだ R を呼ばない",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))),
    example = par_example(),
    batch = par_measure(p)
  )
}
