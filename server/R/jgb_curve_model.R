# Month-end JGB and US Treasury yield curves for the yield-curve explorer (GET /api/jgb-curves).
# - JGB yields: Ministry of Finance, Japan, month-end compound yields (server/data/jgb_curves/jgb_month_end.csv).
# - US Treasury yields: FRB H.15 / FRED Constant Maturity yields (server/data/jgb_curves/ust_month_end.csv).
# Each month's curve is built by rmql: the yields become discount factors (1 + y)^-t at their tenors,
# a monotonic log-cubic discount curve runs through them, and its annually compounded zero rates are read every half year.
# All months are computed once, on the first request, and kept: the page fetches them together and reuses them
# while the reader moves the slider or plays the months.

JGB_CURVE_FILE <- file.path(script_dir, "data", "jgb_curves", "jgb_month_end.csv")
UST_CURVE_FILE <- file.path(script_dir, "data", "jgb_curves", "ust_month_end.csv")
JGB_CURVES <- new.env()

jgb_month_curve <- function(rows) {
  ref <- as.Date(rows$date[1])
  tenors <- rows$tenor_years
  node_dates <- ref + round(365.25 * tenors)
  t <- as.numeric(node_dates - ref) / 365
  df <- (1 + rows$yield_pct / 100)^(-t)
  curve <- rmql::with_extrapolation(
    rmql::create_discount_curve(c(ref, node_dates), c(1, df), "actual_365_fixed", "monotonic_log_cubic")
  )
  grid <- seq(0.5, max(tenors), by = 0.5)
  grid_dates <- ref + round(365.25 * grid)
  zero <- rmql::compute_zero_rate(curve, grid_dates, "actual_365_fixed", "compounded", 1L)
  # columns, to keep the response small: the curve's tenors are 0.5, 1.0, ... (curve_step)
  list(month = rows$month[1], date = format(ref), node_tenor = tenors, node_yield_pct = rows$yield_pct,
       curve_yield_pct = round(100 * zero, 4))
}

build_market_curves <- function(csv_file, x_max, source_text, source_url, data_url) {
  months <- readr::read_csv(csv_file, col_types = readr::cols(month = "c", date = "c", .default = "d")) |>
    dplyr::arrange(month, tenor_years) |>
    dplyr::group_split(month) |>
    purrr::map(jgb_month_curve)
  all_y <- purrr::map(months, \(m) c(m$curve_yield_pct, m$node_yield_pct)) |> purrr::list_c()
  list(
    months = months,
    curve_step = 0.5,
    axis = list(x_max = x_max, y_min = floor(min(all_y) * 2) / 2, y_max = ceiling(max(all_y) * 2) / 2),
    conventions = list(
      source = source_text,
      source_url = source_url,
      data_url = data_url,
      curve = "各年限の利回りを割引係数 (1+y)^-t にし、単調な対数3次補間の割引カーブ（create_discount_curve）を通して、0.5年刻みの年複利のゼロ金利を読む",
      engine = paste("rmql", as.character(utils::packageVersion("rmql")))
    )
  )
}

jgb_curves <- function() {
  if (!is.null(JGB_CURVES$value)) return(JGB_CURVES$value)
  jgb <- build_market_curves(
    JGB_CURVE_FILE,
    x_max = 40,
    source_text = "財務省「国債金利情報」（Interest Rate Historical Data、jgbcme_all.csv）の各月の最終観測日の複利利回り",
    source_url = "https://www.mof.go.jp/jgbs/reference/interest_rate/index.htm",
    data_url = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/historical/jgbcme_all.csv"
  )
  ust <- build_market_curves(
    UST_CURVE_FILE,
    x_max = 30,
    source_text = "米連邦準備制度理事会（FRB）H.15 Selected Interest Rates ／ セントルイス連銀 FRED（Constant Maturity Treasury: DGS1, DGS2, DGS3, DGS5, DGS7, DGS10, DGS20, DGS30）の各月の最終観測日の利回り",
    source_url = "https://fred.stlouisfed.org/categories/115",
    data_url = "https://fred.stlouisfed.org/series/DGS10"
  )
  JGB_CURVES$value <- c(jgb, list(ust = ust))
  JGB_CURVES$value
}
