# Shared by the precomputed results of chapter 13 (server/data/p16/). Run the scripts from the repository root:
#   Rscript server/scripts/p16/lookback_convergence.R
#   Rscript server/scripts/p16/convertible_curve.R
#   Rscript server/scripts/p16/mscb_reset_closed_form.R
#   Rscript server/scripts/p16/mscb_carried_grid.R
# Each writes one JSON file with its `meta` (the version of rmql, the date, the seed, the machine). Times in the files are those
# of this machine on the day, and change with it.

suppressPackageStartupMessages({
  library(rmql)
  library(jsonlite)
})

P16_OUT <- file.path("server", "data", "p16")
dir.create(P16_OUT, recursive = TRUE, showWarnings = FALSE)

p16_meta <- function(script, seed = NA_integer_, note = "") {
  list(
    script = script, rmql_version = as.character(packageVersion("rmql")), generated = format(Sys.time(), "%Y-%m-%d %H:%M:%S"), seed = seed,
    r_version = paste(R.version$major, R.version$minor, sep = "."), platform = R.version$platform, logical_processors = parallel::detectCores(logical = TRUE),
    note = note
  )
}

p16_write <- function(file, x) {
  path <- file.path(P16_OUT, file)
  write_json(x, path, auto_unbox = TRUE, digits = NA, pretty = FALSE, na = "null")
  cat(sprintf("written: %s (%.0f KB)\n", normalizePath(path, winslash = "/"), file.size(path) / 1024))
}

# The shortest of `reps` runs, after one to warm up.
p16_time <- function(f, reps = 3L) {
  invisible(f())
  min(vapply(seq_len(reps), \(i) unname(system.time(f())[["elapsed"]]), 0))
}

p16_settlement <- "2026-11-02"
p16_bond <- function(years = 5, coupon = 0.02, tenor = "6M") {
  maturity <- seq(as.Date(p16_settlement), by = paste(as.integer(12 * years), "months"), length.out = 2L)[2]
  create_fixed_rate_bond(0L, 100, p16_settlement, maturity, tenor, "japan", "unadjusted", "unadjusted", "backward", FALSE, coupon, "actual_365_fixed", "unadjusted", 100)
}
p16_years_to_date <- function(years) seq(as.Date(p16_settlement), by = paste(as.integer(round(12 * years)), "months"), length.out = 2L)[2]
