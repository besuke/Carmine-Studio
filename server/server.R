# HTTP API for Carmine-Studio (httpuv). By default it listens on 127.0.0.1 only.
#
#   Rscript server/server.R [--port 8787] [--host 127.0.0.1] [--static dist]
#
#   --host 0.0.0.0  listen on every network interface (company LAN; see README "社内LANで使う")
#   --static DIR    also serve the built page (npm run build) from DIR, so page and API share one port
#
#   GET  /api/health    -> {"status":"ok", ...}
#   GET  /api/jgb-curves -> month-end JGB yield curves built by rmql (the yield-curve slider)
#   GET  /api/server    -> engine and R versions, address, uptime, routes, one timed rmql call (connection page)
#   POST /api/scenario  {"bumpTenor":"5Y","bumpBp":1} -> curves, 7Y OIS par rate and PVs (see README.md)
#   POST /api/curves/zero         {"zeroRatesPct":[...], "shiftBp":50, "bump":{"tenor":"10Y","bp":100}} -> zero / discount / shifted curves (II-2)
#   POST /api/futures/basket      {"mode":"current"} | {"mode":"flat","yieldPct":8,"fundingPct":9} -> CTD, basis, futures BPV
#   POST /api/cds                 {"flat":{"spreadBp":130,...},"isda":{"spreadBp":30.426,...}} -> CDS legs, hazard, ISDA (II-5)
#   POST /api/black               {"black":{...},"mc":{"sequence":"pseudo","paths":200},"bsm":{...},"lsm":{"paths":2048}} -> II-4
#   POST /api/bond                {"shapes":{...},"bond":{"simpleYieldPct":6.515,"couponPct":7.5,"zSpreadBp":50}} -> II-1
#   POST /api/calibration         {"normal":{...},"sabr":{"beta":0.5},"hw":{...},"bgm":{"decay":0.45}} -> II-6
#   POST /api/rate-models         {"hw":{...},"caplet":{...},"shocks":{...},"fixings":{...}} -> II-7
#   POST /api/callable            {"bond":{...},"mbs":{"psaPct":100,...}} -> callable bond and MBS (II-8)
#   POST /api/prdc                {"note":{...},"mc":{"paths":3000,"seed":123}} -> PRDC note (II-9)
#   POST /api/parallel            {"batch":{"count":10000,"maxThreads":8}} -> parallel valuation timing (III-1)
#   GET  /api/cnn/jgb-summary     -> the 1D-CNN experiment: metrics, errors, kernels (chapter 11.4)
#   POST /api/cnn/jgb-forecast    {"month":"202101","bond":{"remainingYears":10,"couponPct":1}} -> forecast curves, bond value and P&L by rmql
#   POST /api/lookback            {"lookbackType":"floating","optionType":"call","spot":100,...} -> lookback option, continuous and discrete (13.2)
#   POST /api/convertible         {"bond":{...},"conversion":{...},"market":{...},"steps":200} -> convertible bond, fixed or reset price (13.3, 13.4)
#   POST /api/mscb                {"bond":{...},"resetYears":[1,2],"rule":"downward_only","method":"scaled"} -> price carried between resets (13.5)
#   POST /api/cnn/bs-surrogate, GET /api/cnn/bs-summary -> chapter 11.5: a network that learned the Black-Scholes call price, against the closed form
#   POST /api/mbs/state, /api/prdc/tarn, GET /api/mbs-prdc/summary -> chapter 14: the MBS balance and OAS, the PRDC target redemption and knock-out
#   GET  /api/lookback-convertible/summary -> the precomputed convergence and comparison tables of chapter 13
#   POST /api/prdc-risk           {"market":{...},"mc":{...},"threads":{...}} -> PRDC risk: AD vs bump, threads (Part III)
#   POST /api/prdc-risk/job       {"scenarios":[{"id":1,"spot":150,"volPct":12},...]} -> one job of the distributed grid
#   GET  /api/asw/offers          -> the ASW offer sheet (Curie demo data)
#   GET  /api/asw/offers/<id>     -> one offer: curve, price conversion, cash flows, ASW components

suppressPackageStartupMessages({
  library(httpuv)
  library(jsonlite)
})

# The chapters on lookback options, convertible bonds and MSCB (13) use rmql 0.5.0 (P16).
if (utils::packageVersion("rmql") < "0.5.0") {
  stop("rmql 0.5.0 以上が必要です（現在 ", as.character(utils::packageVersion("rmql")), "）。",
       "../RiemannQL/docs/client_guide.md の手順で入れ直してください（入れ替える前に、この R API を止めます）。", call. = FALSE)
}

script_dir <- local({
  arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
  if (length(arg)) dirname(normalizePath(sub("^--file=", "", arg[1L]), winslash = "/")) else getwd()
})
source(file.path(script_dir, "R", "tona_ois_model.R"))
source(file.path(script_dir, "R", "asw_model.R"))
source(file.path(script_dir, "R", "asw_report.R"))
source(file.path(script_dir, "R", "curve_model.R"))
source(file.path(script_dir, "R", "futures_model.R"))
source(file.path(script_dir, "R", "cds_model.R"))
source(file.path(script_dir, "R", "black_model.R"))
source(file.path(script_dir, "R", "bond_model.R"))
source(file.path(script_dir, "R", "calibration_model.R"))
source(file.path(script_dir, "R", "rate_models_model.R"))
source(file.path(script_dir, "R", "callable_model.R"))
source(file.path(script_dir, "R", "prdc_model.R"))
source(file.path(script_dir, "R", "parallel_model.R"))
source(file.path(script_dir, "R", "prdc_risk_model.R"))
source(file.path(script_dir, "R", "prdc_three_factor_model.R"))
source(file.path(script_dir, "R", "prdc_scenario_model.R"))
source(file.path(script_dir, "R", "server_info.R"))
source(file.path(script_dir, "R", "jgb_curve_model.R"))
source(file.path(script_dir, "R", "cnn_model.R"))
source(file.path(script_dir, "R", "lookback_model.R"))
source(file.path(script_dir, "R", "convertible_model.R"))
source(file.path(script_dir, "R", "mbs_prdc_model.R"))
source(file.path(script_dir, "R", "bs_surrogate_model.R"))
# the demo data do not change while the server runs
ASW_LIST <- asw_list()
ASW_REPORT <- asw_report()

args <- commandArgs(trailingOnly = TRUE)
arg_value <- function(name, default) {
  i <- which(args == name)
  if (length(i) && length(args) > i) args[i + 1L] else default
}
port <- as.integer(arg_value("--port", "8787"))
host <- arg_value("--host", "127.0.0.1")
static_dir <- arg_value("--static", NA_character_)
if (!is.na(static_dir)) {
  static_dir <- normalizePath(static_dir, winslash = "/", mustWork = FALSE)
  if (!file.exists(file.path(static_dir, "index.html"))) stop("No index.html in ", static_dir, ". Run npm run build first.")
}

json_response <- function(status, body, request_id = NULL) {
  headers <- list("Content-Type" = "application/json; charset=utf-8", "Cache-Control" = "no-store")
  if (!is.null(request_id)) headers[["X-Request-Id"]] <- request_id
  list(status = as.integer(status), headers = headers,
       body = if (is.character(body)) body else as.character(tona_to_json(body)))
}

# X-Request-Id from the client (1-64 characters of letters, digits, '-' and '_'); otherwise a random one.
request_id <- function(req) {
  id <- req$HTTP_X_REQUEST_ID
  if (is.character(id) && length(id) == 1L && grepl("^[A-Za-z0-9_-]{1,64}$", id)) return(id)
  paste0("srv-", paste(sample(c(0:9, letters[1:6]), 16L, replace = TRUE), collapse = ""))
}

read_body <- function(req) {
  input <- req$rook.input
  if (is.null(input)) return("")
  raw <- input$read()
  if (length(raw) == 0L) "" else rawToChar(raw)
}

# The POST of the APIs of chapter 13: the body, a request out of range (400, with a message in Japanese) or a failure (500),
# the request ID and the time.
p16_post <- function(req, compute) {
  body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
  if (!is.list(body)) return(json_response(400, list(error = "本文は JSON のオブジェクトにしてください（例：{}）。")))
  result <- tryCatch(compute(body),
                     tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                     error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
  if (inherits(result, "bad")) return(json_response(400, unclass(result)))
  if (inherits(result, "failed")) return(json_response(500, unclass(result)))
  id <- request_id(req)
  result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
  json_response(200, result, request_id = id)
}

handle <- function(req) {
  method <- req$REQUEST_METHOD
  path <- req$PATH_INFO
  SERVER_REQUESTS$count <- SERVER_REQUESTS$count + 1L
  if (identical(path, "/api/jgb-curves")) {
    if (method != "GET") return(json_response(405, list(error = "Use GET.")))
    id <- request_id(req)
    out <- jgb_curves()
    out$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, out, request_id = id))
  }
  if (identical(path, "/api/server")) {
    if (method != "GET") return(json_response(405, list(error = "Use GET.")))
    id <- request_id(req)
    info <- server_info(host, port, static_dir)
    info$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, info, request_id = id))
  }
  if (identical(path, "/api/health")) {
    if (method != "GET") return(json_response(405, list(error = "Use GET.")))
    return(json_response(200, list(
      status = "ok", engine = paste("rmql", as.character(utils::packageVersion("rmql"))),
      evaluation_date = format(TONA_MODEL$evaluation_date), fixed_rate = TONA_FIXED_RATE
    )))
  }
  if (identical(path, "/api/scenario")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object such as {\"bumpTenor\":\"5Y\",\"bumpBp\":1}.")))
    unknown <- setdiff(names(body), c("bumpTenor", "bumpBp"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(
      tona_compute_scenario(body$bumpTenor, body$bumpBp),
      tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
      error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed")
    )
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    # The request ID is echoed back, so the page can show that its charts and PV come from the same response.
    # The server keeps no state: the ID comes from the X-Request-Id header, or is drawn here when absent.
    result$response <- list(request_id = request_id(req), computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = result$response$request_id))
  }
  # OIS asset swap offer sheet (Curie's demo data, read-only)
  # Zero-rate nodes to curves (yield-curve chapter)
  if (identical(path, "/api/curves/zero")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"shiftBp\":50}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("zeroRatesPct", "shiftBp", "bump"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(curve_compute(body$zeroRatesPct, if (is.null(body$shiftBp)) 50 else body$shiftBp, body$bump),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # JGB futures, CTD and futures BPV (II-2.6–2.7)
  if (identical(path, "/api/futures/basket")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"mode\":\"current\"}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("mode", "yieldPct", "fundingPct"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(fut_compute(if (is.null(body$mode)) "current" else body$mode, if (is.null(body$yieldPct)) 8 else body$yieldPct, body$fundingPct),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Credit risk and CDS (II-5)
  if (identical(path, "/api/cds")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"flat\":{\"spreadBp\":130}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("flat", "isda"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(cds_compute(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Black model (II-4)
  if (identical(path, "/api/black")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"mc\":{\"paths\":2000}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("black", "mc", "bsm", "lsm"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(black_compute(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Deterministic cash flows (II-1)
  if (identical(path, "/api/bond")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"bond\":{\"simpleYieldPct\":6.515}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("shapes", "bond"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(bond_compute(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Calibration of interest-rate derivatives (II-6)
  if (identical(path, "/api/calibration")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"sabr\":{\"beta\":0.5}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("normal", "sabr", "hw", "bgm"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(calibration_compute(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Interest-rate models (II-7)
  if (identical(path, "/api/rate-models")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"hw\":{\"aPct\":12}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("hw", "caplet", "shocks", "fixings"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(rate_models_compute(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Early redemption models (II-8)
  if (identical(path, "/api/callable")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"bond\":{\"sigmaPct\":1.2}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("bond", "mbs"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(callable_compute(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # PRDC note (II-9)
  if (identical(path, "/api/prdc")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"note\":{\"spot\":133.2681}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("note", "mc"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(prdc_compute(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Parallel computing (III-1)
  if (identical(path, "/api/parallel")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"batch\":{\"count\":10000}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("batch"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(parallel_compute(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # The 1D-CNN forecast of the JGB curve and a bond's profit and loss (chapter 11.4)
  if (identical(path, "/api/cnn/jgb-summary")) {
    if (method != "GET") return(json_response(405, list(error = "Use GET.")))
    result <- tryCatch(cnn_summary(), error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  if (identical(path, "/api/cnn/jgb-forecast")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"month\":\"202101\"}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    result <- tryCatch(cnn_forecast(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Lookback options, convertible bonds and MSCB (chapter 13)
  for (p16 in list(list("/api/lookback", lookback_compute), list("/api/convertible", convertible_compute), list("/api/mscb", mscb_compute),
                    list("/api/mbs/state", mbs_state_compute), list("/api/prdc/tarn", prdc_tarn_compute),
                    list("/api/cnn/bs-surrogate", bs_surrogate_compute))) {
    if (identical(path, p16[[1]])) {
      if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body (every field is optional), for example {}.")))
      return(p16_post(req, p16[[2]]))
    }
  }
  if (identical(path, "/api/lookback-convertible/summary")) {
    if (method != "GET") return(json_response(405, list(error = "Use GET.")))
    result <- tryCatch(lookback_convertible_summary(), error = function(e) structure(list(error = conditionMessage(e)), class = "failed"))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  if (identical(path, "/api/cnn/bs-summary")) {
    if (method != "GET") return(json_response(405, list(error = "Use GET.")))
    result <- tryCatch(bs_summary(), error = function(e) structure(list(error = conditionMessage(e)), class = "failed"))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  if (identical(path, "/api/mbs-prdc/summary")) {
    if (method != "GET") return(json_response(405, list(error = "Use GET.")))
    result <- tryCatch(mbs_prdc_summary(), error = function(e) structure(list(error = conditionMessage(e)), class = "failed"))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # PRDC risk by automatic differentiation, in parallel and distributed (Part III)
  # Chapter 15: correlation sensitivities, cross-gammas and Vanna of the three-factor PRDC (automatic differentiation and finite differences)
  # Chapter II-9: the scenario of the PRDC with the cross terms and the second-order approximation
  if (identical(path, "/api/prdc/scenario")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"shock\":{\"spotYen\":5}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("note", "shock"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(prdc_scenario(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Chapter 15: the heat maps of the scenario (spot x volatility, spot x a rate), every cell valued first
  if (identical(path, "/api/prdc-three-factor/heatmap")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"shock\":{\"volPoints\":2}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("correlation", "shock"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(prdc_three_factor_heatmap(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Chapter 15: the scenario against the spot, every point valued first (for the draggable line)
  if (identical(path, "/api/prdc-three-factor/scenario-curve")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"shock\":{\"volPoints\":2}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("correlation", "shock"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(prdc_three_factor_scenario_curve(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Chapter 15: the example of the cross term, an unhedged foreign bond
  if (identical(path, "/api/cross-term-example")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"bondPct\":-2,\"fxPct\":5}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    result <- tryCatch(cross_term_example(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Chapter 15: the scenario of the three-factor PRDC (spot, FX volatility and the two curves moved together: full revaluation, first order, first order plus the cross terms)
  if (identical(path, "/api/prdc-three-factor/scenario")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"shock\":{\"spotYen\":5}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("correlation", "shock"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(prdc_three_factor_scenario(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # Chapter 15: the graphs of the three-factor PRDC (the value against each correlation, the delta against the rates and the volatility)
  if (identical(path, "/api/prdc-three-factor/scan")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"correlation\":{\"domesticForeign\":0.3}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("correlation"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(prdc_three_factor_scan(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  if (identical(path, "/api/prdc-three-factor")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"correlation\":{\"domesticForeign\":0.3}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("correlation"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(prdc_three_factor_compute(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  if (identical(path, "/api/prdc-risk")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"market\":{\"spot\":150}}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("market", "mc", "threads"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(prdc_risk_compute(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  # One job of the distributed scenario grid (Part III)
  if (identical(path, "/api/prdc-risk/job")) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"scenarios\":[{\"id\":1,\"spot\":150,\"volPct\":12}]}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body)) return(json_response(400, list(error = "The body must be a JSON object.")))
    unknown <- setdiff(names(body), c("scenarios"))
    if (length(unknown)) return(json_response(400, list(error = paste("Unknown fields:", paste(unknown, collapse = ", ")))))
    result <- tryCatch(prdc_risk_job(body),
                       tona_bad_request = function(e) structure(list(error = conditionMessage(e)), class = "bad"),
                       error = function(e) structure(list(error = paste("Calculation failed:", conditionMessage(e))), class = "failed"))
    if (inherits(result, "bad")) return(json_response(400, unclass(result)))
    if (inherits(result, "failed")) return(json_response(500, unclass(result)))
    id <- request_id(req)
    result$response <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, result, request_id = id))
  }
  if (identical(path, "/api/asw/report")) {
    if (method != "GET") return(json_response(405, list(error = "Use GET.")))
    id <- request_id(req)
    stamp <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    return(json_response(200, c(ASW_REPORT, list(response = stamp)), request_id = id))
  }
  # A quote given as a spread over JGBs, converted to a price (yen bonds only)
  if (grepl("^/api/asw/offers/[A-Za-z0-9_-]{1,32}/jgb-spread$", path)) {
    if (method != "POST") return(json_response(405, list(error = "Use POST with a JSON body such as {\"spreadBp\":11.5}.")))
    body <- tryCatch(jsonlite::fromJSON(read_body(req), simplifyVector = TRUE), error = function(e) NULL)
    if (!is.list(body) || !identical(names(body), "spreadBp")) return(json_response(400, list(error = "The body must be {\"spreadBp\": <number>}.")))
    out <- asw_jgb_spread_quote(sub("^/api/asw/offers/([^/]+)/jgb-spread$", "\\1", path), body$spreadBp)
    id <- request_id(req)
    if (out$status != 200L) return(json_response(out$status, out$body))
    return(json_response(200, c(out$body, list(response = list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z")))), request_id = id))
  }
  if (identical(path, "/api/asw/offers") || startsWith(path, "/api/asw/offers/")) {
    if (method != "GET") return(json_response(405, list(error = "Use GET.")))
    id <- request_id(req)
    stamp <- list(request_id = id, computed_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"))
    if (identical(path, "/api/asw/offers")) {
      return(json_response(200, c(ASW_LIST, list(response = stamp)), request_id = id))
    }
    offer_id <- utils::URLdecode(sub("^/api/asw/offers/", "", path))
    if (!grepl("^[A-Za-z0-9_-]{1,32}$", offer_id)) return(json_response(400, list(error = "Invalid offer id.")))
    detail <- asw_detail(offer_id)
    if (is.null(detail)) return(json_response(404, list(error = paste("No such offer:", offer_id))))
    return(json_response(200, c(detail, list(response = stamp)), request_id = id))
  }
  json_response(404, list(error = paste("Not found:", path)))
}

app <- list(call = function(req) {
  tryCatch(handle(req), error = function(e) json_response(500, list(error = conditionMessage(e))))
})
if (!is.na(static_dir)) {
  # GET of the page and its assets is served from the build; /api always goes to handle().
  app$staticPaths <- list(
    "/" = httpuv::staticPath(static_dir, indexhtml = TRUE, fallthrough = TRUE),
    "/api" = httpuv::excludeStaticPath()
  )
}

# IPv4 addresses of this PC, to tell other PCs where to connect (best effort, Windows only).
lan_addresses <- function() {
  cmd <- "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress"
  out <- tryCatch(suppressWarnings(system2("powershell", c("-NoProfile", "-Command", shQuote(cmd)), stdout = TRUE, stderr = FALSE)),
                  error = function(e) character())
  out[grepl("^\\d+\\.\\d+\\.\\d+\\.\\d+$", trimws(out))]
}

# The address people on the LAN use (the connection page and the startup message): the host name of the
# deployment, from the environment variable CARMINE_PUBLIC_HOST or "publicHost" in carmine.config.json at the
# project's root, else this server's LAN addresses. 127.0.0.1 is for this PC and the internal calls only.
public_info <- function(host, port, static_dir) {
  config_file <- file.path(dirname(script_dir), "carmine.config.json")
  config <- if (file.exists(config_file)) tryCatch(jsonlite::fromJSON(config_file), error = function(e) list()) else list()
  env <- Sys.getenv("CARMINE_PUBLIC_HOST", "")
  configured <- if (nzchar(env)) env else if (is.character(config$publicHost) && nzchar(config$publicHost)) config$publicHost else ""
  serving <- identical(host, "0.0.0.0") && !is.na(static_dir)
  page_port <- if (serving) port else if (is.numeric(config$port)) as.integer(config$port) else 8081L
  hosts <- unique(c(if (nzchar(configured)) configured, trimws(lan_addresses())))
  list(host = if (length(hosts)) hosts[[1]] else "", source = if (nzchar(env)) "env" else if (nzchar(configured)) "config" else "lan",
       port = page_port, serving = serving, urls = I(sprintf("http://%s:%d/", hosts, page_port)))
}
SERVER_PUBLIC <- public_info(host, port, static_dir)

cat(sprintf("Carmine-Studio API on http://%s:%d (rmql %s, fixed rate %.17g)\n",
            host, port, as.character(utils::packageVersion("rmql")), TONA_FIXED_RATE))
if (!is.na(static_dir)) cat("Serving the page from", static_dir, "\n")
if (host == "0.0.0.0") {
  cat("Listening on every network interface. People on the LAN open:\n")
  for (u in SERVER_PUBLIC$urls) cat(sprintf("  %s\n", u))
  if (!length(SERVER_PUBLIC$urls)) cat(sprintf("  http://<this server's host name or IP address>:%d/\n", port))
}
flush.console()
httpuv::runServer(host, port, app)
