# Supplementary: GaussQuant flat_forward (PiecewiseFlatForward) vs log_linear_discount (PiecewiseLogLinearDiscount).
# rmql has no flat-forward bootstrap, so this checks whether log_linear can stand in for it.
#   "C:/Program Files/R/R-4.6.0/bin/Rscript.exe" C:/AnalyticFin/Projects/Carmine-Studio/server/tests/reconciliation/check_flat_forward_vs_log_linear.R

suppressPackageStartupMessages({ library(GaussQuant); library(QuantLib); library(dplyr); library(purrr) })

evaluation_date <- "2026-09-10"
q_all <- GaussQuant::bluegamma_tonar_quotes_GQL()
sets <- list(with_7y = q_all, without_7y = dplyr::filter(q_all, quote_id != "TONAR-7Y"))
bump <- function(q) { q$rate[q$quote_id == "TONAR-5Y"] <- q$rate[q$quote_id == "TONAR-5Y"] + 1e-4; q }
grid <- seq(as.Date(evaluation_date) + 1L, as.Date("2056-09-10"), by = "1 month")

df_on <- function(q, type) {
  b <- GaussQuant::build_tonar_curve_from_market_GQL(q, evaluation_date, curve_type = type)
  list(df = purrr::map_dbl(as.character(grid), ~ b$curve$discount(GaussQuant::date_GQL(.x))),
       par7 = GaussQuant::build_ois_GQL(QuantLib::Period(7L, "Years"), QuantLib::Tonar(b$curve_handle), 0)$fairRate())
}

res <- purrr::imap_dfr(sets, function(q, nm) {
  purrr::imap_dfr(list(base = q, bump_5y = bump(q)), function(qq, case) {
    ff <- df_on(qq, "flat_forward"); ll <- df_on(qq, "log_linear_discount")
    tibble::tibble(quote_set = nm, case = case, n = length(grid),
                   max_abs_df_diff = max(abs(ff$df - ll$df)), max_rel_df_diff = max(abs(ff$df / ll$df - 1)),
                   par7_diff = ff$par7 - ll$par7)
  })
})

options(width = 200, pillar.sigfig = 6)
print(res)
utils::write.csv(res, "C:/AnalyticFin/Projects/Carmine-Studio/server/tests/reconciliation/results/flat_forward_vs_log_linear.csv", row.names = FALSE)
