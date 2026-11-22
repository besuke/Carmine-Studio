# Copy Curie's A1 offer-sheet demo (fictitious data) into Carmine Studio, so the API does not read Curie at run time.
#
#   node ui/scripts/run-r.mjs server/scripts/asw/snapshot_curie_demo.R
#
# Writes server/data/asw_demo/:
#   offers.csv             offers as Curie's converter read them from the demo Excel books
#                          (Curie output/work/{JPY,ISO}/offers_standard_*_20261006.xlsx)
#   offer_columns.csv      how each column of the original offer Excel maps to the standard fields
#                          (Curie convert_offer_sheet_Curie(), run here on data/demo/offers/*.xlsx)
#   attributes.csv         bond attributes (Curie data/demo/attributes/demo_attributes_20261006.rds)
#   ois_{JPY,USD,EUR}.txt, fx.txt, basis.txt, jgb.txt   market data, copied unchanged (Curie data/demo/market)
#   curie_reference.json   the old demo results (Curie output/offer_results_{JPY,ISO}_demo_20261006.xlsx):
#                          offer results, JGB yields and averages, OIS curve checks, market data log, basis averages, FX
#   PROVENANCE.md          sources, Curie commit, file times and SHA-256
# Curie is only read. The API compares its own numbers with curie_reference.json; so do the tests.

suppressPackageStartupMessages({ library(dplyr); library(readxl); library(jsonlite) })

curie <- "C:/AnalyticFin/Projects/Curie"
root <- "C:/AnalyticFin/Projects/Carmine-Studio"
data_dir <- file.path(root, "server/data/asw_demo")
dir.create(data_dir, recursive = TRUE, showWarnings = FALSE)

src <- list(
  offers_jpy = "output/work/JPY/offers_standard_JPY_20261006.xlsx",
  offers_iso = "output/work/ISO/offers_standard_ISO_20261006.xlsx",
  offer_book_jpy = "data/demo/offers/demo_offers_JPY_20261006.xlsx",
  offer_book_iso = "data/demo/offers/demo_offers_ISO_20261006.xlsx",
  attributes = "data/demo/attributes/demo_attributes_20261006.rds",
  ois_JPY = "data/demo/market/demo_ois_JPY_20261006.txt",
  ois_USD = "data/demo/market/demo_ois_USD_20261006.txt",
  ois_EUR = "data/demo/market/demo_ois_EUR_20261006.txt",
  fx = "data/demo/market/demo_fx_20261006.txt",
  basis = "data/demo/market/demo_basis_20261006.txt",
  jgb = "data/demo/market/demo_jgb_20261006.txt",
  results_jpy = "output/offer_results_JPY_demo_20261006.xlsx",
  results_iso = "output/offer_results_ISO_demo_20261006.xlsx"
)
path <- function(key) file.path(curie, src[[key]])
out_name <- c(offers_jpy = "offers.csv", offers_iso = "offers.csv", offer_book_jpy = "offer_columns.csv",
              offer_book_iso = "offer_columns.csv", attributes = "attributes.csv", ois_JPY = "ois_JPY.txt",
              ois_USD = "ois_USD.txt", ois_EUR = "ois_EUR.txt", fx = "fx.txt", basis = "basis.txt", jgb = "jgb.txt",
              results_jpy = "curie_reference.json", results_iso = "curie_reference.json")
iso_date <- function(x) ifelse(is.na(x), NA_character_, format(as.Date(x), "%Y-%m-%d"))

# ---- Offers ---------------------------------------------------------------------------------------
read_offers <- function(key, book) {
  read_excel(path(key), sheet = "offers") |>
    mutate(offer_book = book, offer_date = as.Date(offer_date), offer_settlementdate = as.Date(offer_settlementdate))
}
offers <- bind_rows(read_offers("offers_jpy", "JPY"), read_offers("offers_iso", "ISO")) |>
  mutate(offer_id = sprintf("%s-%02d", offer_book, row_number()), .by = offer_book) |>
  transmute(offer_id, offer_book, offer_date, ISIN, broker_names, offer_price, offer_size, offer_size_unit,
            offer_settlementdate, offer_currency, offer_security_name, sheet_issue_price,
            offer_source_file = basename(offer_source_file), offer_source_sheet, offer_source_row)
utils::write.csv(offers, file.path(data_dir, "offers.csv"), row.names = FALSE, fileEncoding = "UTF-8")

# ---- Column mapping of the original offer books, read with Curie's own converter -------------------------
old_wd <- setwd(curie)
suppressMessages(source("R/load_Curie.R", encoding = "UTF-8"))
mapping <- function(key, book, sheet, currency = NULL) {
  x <- convert_offer_sheet_Curie(path(key), sheet = sheet, currency = currency)
  m <- attr(x, "column_mapping")
  tibble::tibble(offer_book = book, file = basename(path(key)), sheet = unique(x$offer_source_sheet),
                 header_row = unique(x$offer_header_row), source_header = m$source_header, field = m$field,
                 size_unit = unique(x$offer_size_unit), size_multiplier = unique(x$offer_size_multiplier))
}
columns <- bind_rows(mapping("offer_book_jpy", "JPY", "円債オファー", "JPY"), mapping("offer_book_iso", "ISO", "Offers"))
setwd(old_wd)
utils::write.csv(columns, file.path(data_dir, "offer_columns.csv"), row.names = FALSE, fileEncoding = "UTF-8")

attributes <- readRDS(path("attributes")) |> tibble::as_tibble()
utils::write.csv(attributes, file.path(data_dir, "attributes.csv"), row.names = FALSE, fileEncoding = "UTF-8", na = "")

for (k in c("ois_JPY", "ois_USD", "ois_EUR", "fx", "basis", "jgb")) file.copy(path(k), file.path(data_dir, out_name[[k]]), overwrite = TRUE)

# ---- The old results ----------------------------------------------------------------------------------
num_cols <- c("offer_price", "accrued_per_100", "dirty_price", "native_asw_bp", "jpy_compound_yield_pct",
              "jgb_interpolated_yield_pct", "jgb_spread_bp", "fx_spot", "basis_bp", "jpy_asw_bp", "simple_sum_bp",
              "calibrated_discount_spread_bp", "ccs_repricing_npv_jpy", "fair_spread_npv_jpy")
chr_cols <- c("jgb_spread_status", "jpy_asw_status", "validation_status", "validation_message", "pricing_status", "pricing_message")
date_cols <- c("asw_effective_date", "asw_maturity_date", "fx_spot_date", "calculation_end_date", "offer_settlementdate")
read_results <- function(key, book) {
  x <- read_excel(path(key), sheet = "オファー結果")
  for (col in setdiff(num_cols, names(x))) x[[col]] <- NA_real_
  for (col in setdiff(c(chr_cols, date_cols), names(x))) x[[col]] <- NA
  x |>
    mutate(across(all_of(date_cols), iso_date), offer_book = book) |>
    select(offer_book, ISIN, broker_names, all_of(num_cols), all_of(date_cols), all_of(chr_cols))
}
sheet <- function(key, name) read_excel(path(key), sheet = name) |> mutate(across(where(\(v) inherits(v, c("POSIXct", "Date"))), iso_date))
reference <- list(
  description = "Curie A1 offer-sheet demo results (fictitious data): the reference the Carmine Studio API is compared with",
  source = c(src$results_jpy, src$results_iso),
  curie_commit = system2("git", c("-C", curie, "rev-parse", "HEAD"), stdout = TRUE),
  generated_by = "server/scripts/asw/snapshot_curie_demo.R",
  conditions = list(valuation_date = "2026-10-06", curve = "log_cubic_discount (MonotonicLogCubic), OIS annual, payment lag 0",
                    asw_overnight_leg = "Semiannual, payment lag 0 (Curie demo assumption)",
                    jgb = "GaussQuant bond_compound_yield_from_price_YEN_GQL, clean price, coupons and compounding twice a year",
                    engine = "QuantLib 1.42 with GaussQuant 2026.9.12.1 (Curie run of 2026-10-27)"),
  results = bind_rows(read_results("results_jpy", "JPY"), read_results("results_iso", "ISO")),
  jgb_yields = sheet("results_jpy", "JGB利回り"),
  jgb_average = sheet("results_jpy", "JGB利回り_平均"),
  curves = list(JPY = sheet("results_jpy", "OISカーブ"), ISO = sheet("results_iso", "OISカーブ")),
  market_log = list(JPY = sheet("results_jpy", "市場データ"), ISO = sheet("results_iso", "市場データ")),
  basis_average = sheet("results_iso", "通貨ベーシス_平均"),
  fx = sheet("results_iso", "FXスポット")
)
write(toJSON(reference, auto_unbox = TRUE, digits = I(17), pretty = TRUE, na = "null"), file.path(data_dir, "curie_reference.json"))

# ---- Provenance -----------------------------------------------------------------------------------------
sha <- function(f) gsub(" ", "", system2("certutil", c("-hashfile", shQuote(f), "SHA256"), stdout = TRUE)[2])
prov <- c(
  "# ASW デモデータの出所",
  "",
  "Curie の A1 オファーシートのデモデータ（**すべて架空**。実在の銘柄・市場価格ではない）と、その旧デモの結果をコピーしたもの。",
  "`server/scripts/asw/snapshot_curie_demo.R` が作る。Curie は読むだけで変更しない。",
  "",
  paste0("- Curie のコミット：`", system2("git", c("-C", curie, "rev-parse", "--short", "HEAD"), stdout = TRUE), "`"),
  paste0("- 作成日時：", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")),
  "",
  "| このフォルダ | Curie の元ファイル | 更新日時 | SHA-256 |",
  "|---|---|---|---|",
  vapply(names(src), function(k) sprintf("| `%s` | `%s` | %s | `%s` |", out_name[[k]], src[[k]],
                                         format(file.info(path(k))$mtime, "%Y-%m-%d %H:%M"), sha(path(k))), ""),
  "",
  "オファーは、Curie の `convert_offer_sheet_Curie()` がデモの Excel（`data/demo/offers/`）から読んだ標準形式（`output/work/`）を使う。",
  "単価は額面100あたりのクリーン価格、数量は額面金額（通貨単位）。`offer_columns.csv` は、元の Excel の見出しと標準形式の列の対応である。"
)
writeLines(prov, file.path(data_dir, "PROVENANCE.md"), useBytes = TRUE)
cat("offers:", nrow(offers), " columns:", nrow(columns), " attributes:", nrow(attributes),
    " results:", nrow(reference$results), " jgb:", nrow(reference$jgb_yields), "\n")
