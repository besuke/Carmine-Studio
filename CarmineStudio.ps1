# CarmineStudio.ps1 - start rmql Compute Server (R + rmql) and the Carmine-Studio page, then open it.
#
#   powershell -ExecutionPolicy Bypass -File CarmineStudio.ps1          menu
#   powershell -ExecutionPolicy Bypass -File CarmineStudio.ps1 dev      this PC: API 127.0.0.1:8787, page http://127.0.0.1:8081/
#   powershell -ExecutionPolicy Bypass -File CarmineStudio.ps1 lan      the LAN: page and API together on port 8081
#
# In the LAN mode the page is opened, and announced, at the deployment's address: the host name in the environment
# variable CARMINE_PUBLIC_HOST, or "publicHost" in carmine.config.json next to this script (see
# carmine.config.example.json), else this PC's LAN IP address. 127.0.0.1 is used only on this PC (the dev mode and
# the internal checks). The page port is always 8081: when it is taken, stop with the reason, never move.

param([ValidateSet("", "dev", "lan")][string]$Mode = "")

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Project = $PSScriptRoot
$UI = Join-Path $Project "ui"   # React・Vite 一式と npm の実行場所
$Node = "C:\Program Files\nodejs\node.exe"
$Npm = "C:\Program Files\nodejs\npm.cmd"
$LocalPage = "http://127.0.0.1:8081/"
$LocalApi = "http://127.0.0.1:8787/api/health"

function Test-Url([string]$Url) {
  try { Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 | Out-Null; return $true } catch { return $false }
}

function Wait-Url([string]$Url, [int]$Seconds, [string]$Name) {
  Write-Host "      $Name の応答を待っています（最大 $Seconds 秒）..."
  for ($i = 0; $i -lt $Seconds; $i++) {
    if (Test-Url $Url) { Write-Host "      $Name が応答しました。"; return }
    Start-Sleep -Seconds 1
  }
  throw "$Name が $Seconds 秒以内に応答しませんでした。起動したウィンドウのメッセージを確認してください。"
}

function Assert-PortFree([int]$Port, [string]$BindHost = "127.0.0.1") {
  & $Node (Join-Path $UI "scripts\check-port.mjs") $Port $BindHost
  if ($LASTEXITCODE -ne 0) { throw "ポート $Port が使えません（上の理由を確認してください）。" }
}

function Start-Window([string]$Title, [string]$NpmScript) {
  Start-Process -FilePath "cmd.exe" -WorkingDirectory $UI -ArgumentList "/k", "title $Title && `"$Npm`" run $NpmScript" | Out-Null
}

# The addresses people on the LAN use: the configured host name first, then this PC's LAN IPv4 addresses.
function Get-PublicHosts {
  $hosts = @()
  if ($env:CARMINE_PUBLIC_HOST) { $hosts += $env:CARMINE_PUBLIC_HOST }
  $config = Join-Path $Project "carmine.config.json"
  if (-not $env:CARMINE_PUBLIC_HOST -and (Test-Path $config)) {
    $c = Get-Content $config -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($c.publicHost) { $hosts += [string]$c.publicHost }
  }
  $hosts += Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -ExpandProperty IPAddress
  return $hosts | Select-Object -Unique
}

function Start-Dev {
  Write-Host ""
  if (Test-Url $LocalApi) {
    Write-Host "[1/3] rmql Compute Server はすでに起動しています（127.0.0.1:8787）。そのまま使います。"
  } else {
    Assert-PortFree 8787
    Write-Host "[1/3] rmql Compute Server を別のウィンドウで起動します（127.0.0.1:8787）..."
    Start-Window "Carmine-Studio - rmql Compute Server (8787)" "api"
    Wait-Url $LocalApi 120 "rmql Compute Server"
  }
  if (Test-Url $LocalPage) {
    Write-Host "[2/3] 画面はすでに起動しています（$LocalPage）。そのまま使います。"
  } else {
    Assert-PortFree 8081
    Write-Host "[2/3] 画面を別のウィンドウで起動します（$LocalPage）..."
    Start-Window "Carmine-Studio - page (8081)" "dev"
    Wait-Url $LocalPage 60 "画面"
  }
  Write-Host "[3/3] ブラウザで $LocalPage を開きます（このPCでの開発用）。"
  Start-Process $LocalPage
  Write-Host ""
  Write-Host "止めるときは「Carmine-Studio - rmql Compute Server (8787)」と「Carmine-Studio - page (8081)」のウィンドウを閉じてください。"
}

function Start-Lan {
  Write-Host ""
  Assert-PortFree 8081 "0.0.0.0"
  $hosts = @(Get-PublicHosts)
  if (-not $hosts.Count) { throw "公開に使うホスト名も LAN の IP アドレスも見つかりません。carmine.config.json の publicHost を設定してください。" }
  $url = "http://$($hosts[0]):8081/"
  Write-Host "[1/2] 画面をビルドし、画面と計算を 8081 でまとめて公開します（別のウィンドウ）..."
  Start-Window "Carmine-Studio - LAN (8081)" "lan"
  Wait-Url $LocalPage 300 "社内LAN用のサーバー"
  # the name may take a moment to resolve right after the start: try for up to 15 seconds before warning
  $reached = $false
  for ($i = 0; $i -lt 5 -and -not $reached; $i++) { $reached = Test-Url $url; if (-not $reached) { Start-Sleep -Seconds 3 } }
  if (-not $reached) { Write-Host "      注意：$url にこのPCから届きません。ホスト名の DNS 登録かファイアウォールを確認してください。" }
  Write-Host "[2/2] ブラウザで $url を開きます。"
  Start-Process $url
  Write-Host ""
  Write-Host "社内の利用者には次のアドレスを案内してください（Windows ファイアウォールで 8081 の受信を許可しておきます）："
  foreach ($h in $hosts) { Write-Host "  http://${h}:8081/" }
  Write-Host "止めるときは「Carmine-Studio - LAN (8081)」のウィンドウを閉じてください。"
}

function Invoke-Safely([scriptblock]$Action) {
  try { & $Action } catch { Write-Host ""; Write-Host "停止しました：$($_.Exception.Message)" -ForegroundColor Red }
}

if (-not (Test-Path (Join-Path $UI "package.json"))) { throw "プロジェクトが見つかりません: $Project" }
if (-not (Test-Path $Node)) { throw "Node.js が見つかりません: $Node" }
Set-Location $Project

if ($Mode -eq "dev") { Invoke-Safely { Start-Dev }; exit }
if ($Mode -eq "lan") { Invoke-Safely { Start-Lan }; exit }

while ($true) {
  Write-Host ""
  Write-Host "=============================================================="
  Write-Host " Carmine-Studio『エンタープライズ金融モデル』（計算は rmql Compute Server）"
  Write-Host "=============================================================="
  Write-Host " 1  起動する：rmql Compute Server（8787）と画面（8081）をこのPCで開く"
  Write-Host " 2  社内LANで起動する：画面と計算を 8081 でまとめて公開し、LAN のアドレスで開く"
  Write-Host " 3  ブラウザで画面を開く（起動済みのとき）"
  Write-Host " 4  Claude Code でこの作業の続きを開く"
  Write-Host " 0  終了"
  $choice = Read-Host "番号を選んでください [1-4, 0]"
  switch ($choice) {
    "1" { Invoke-Safely { Start-Dev } }
    "2" { Invoke-Safely { Start-Lan } }
    "3" { if (Test-Url $LocalPage) { Start-Process $LocalPage } else { Write-Host "画面がまだ起動していません。先に 1 か 2 を実行してください。" } }
    "4" { & (Join-Path $env:USERPROFILE "OneDrive\デスクトップ\resume_claude_CarmineStudio.bat") }
    "0" { exit }
    default { Write-Host "1〜4 か 0 を入力してください。" }
  }
}
