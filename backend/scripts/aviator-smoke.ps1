$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

# PowerShell rewrites quotes in native args, so JSON bodies go through a file.
function Send-JsonStatus([string]$url, $body, [string]$token) {
  $inFile = Join-Path $env:TEMP ('avi_in_' + [guid]::NewGuid().ToString('N') + '.json')
  $outFile = Join-Path $env:TEMP ('avi_out_' + [guid]::NewGuid().ToString('N') + '.json')
  $text = if ($body -is [string]) { $body } else { $body | ConvertTo-Json -Compress }
  [System.IO.File]::WriteAllText($inFile, $text, (New-Object System.Text.UTF8Encoding($false)))

  $curlArgs = @('-s', '-o', $outFile, '-w', '%{http_code}', '-X', 'POST', $url,
    '-H', 'Content-Type: application/json', '-d', "@$inFile")
  if ($token) { $curlArgs += @('-H', "Authorization: Bearer $token") }

  $code = & curl.exe @curlArgs
  $raw = if (Test-Path $outFile) { Get-Content $outFile -Raw } else { '' }
  Remove-Item -LiteralPath $inFile, $outFile -Force -ErrorAction SilentlyContinue

  $parsed = $null
  if ($raw -and $raw.Trim()) {
    try { $parsed = $raw | ConvertFrom-Json } catch { $parsed = $null }
  }

  return [pscustomobject]@{ code = [int]$code; body = $parsed }
}

function Get-Json([string]$url, [string]$token) {
  $raw = (& curl.exe -s $url -H "Authorization: Bearer $token" | Out-String)
  return ($raw | ConvertFrom-Json)
}

$phone = '9' + (Get-Random -Minimum 100000000 -Maximum 999999999)
$creds = @{ phone = $phone; password = 'AviatorTest123!' }

Write-Host '== register / login / deposit 300 =='
Send-JsonStatus "$base/auth/register" $creds $null | Out-Null
$login = (Send-JsonStatus "$base/auth/login" $creds $null).body
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send-JsonStatus "$base/wallet/deposit" @{ amount = 300 } $token | Out-Null

$spent = 0.0
$won = 0.0

Write-Host '== config =='
$cfg = Get-Json "$base/game/aviator/config" $token
"tau=$($cfg.growthTauMs) cap=$($cfg.crashCap) minCashout=$($cfg.minCashout)"
if ($cfg.growthTauMs -ne 5500 -or $cfg.crashCap -ne 100) { throw 'unexpected aviator config' }

Write-Host '== start: crash point must NOT leak =='
$start = Send-JsonStatus "$base/game/aviator/start" @{ betAmount = 10 } $token
if ($start.code -ne 201) { throw "start failed: $($start.code)" }
$round = $start.body
$spent += 10
if ($null -ne $round.crashPoint) { throw 'LEAK: crash point returned at start' }
if (-not $round.roundId) { throw 'no roundId' }
if ([double]$round.balanceAfter -ne 290) { throw "stake not debited: $($round.balanceAfter)" }
"round=$($round.roundId) duration=$($round.durationMs)ms balance=$($round.balanceAfter)"

Write-Host '== minimum cash-out rule =='
# 1.01x is reached ~55ms after start, so an HTTP client cannot realistically hit
# the CASHOUT_TOO_EARLY guard; assert the paid floor instead (below).

Write-Host '== cheat attempt: claim 50x after 0.7s =='
Start-Sleep -Milliseconds 700
$cheat = Send-JsonStatus "$base/game/aviator/cashout" @{ roundId = $round.roundId; multiplier = 50 } $token
"status=$($cheat.code) paid=$($cheat.body.multiplier)x payout=$($cheat.body.payout)"
if ($cheat.body.status -ne 'cashed_out') { throw 'expected cashed_out' }
if ([double]$cheat.body.multiplier -ge 2) { throw 'LEAK: client multiplier was trusted' }
if ([double]$cheat.body.multiplier -lt 1.01) { throw 'paid below minimum' }
if ([double]$cheat.body.payout -ne [math]::Round(10 * [double]$cheat.body.multiplier, 2)) {
  throw 'payout != stake * paid multiplier'
}
if ([double]$cheat.body.multiplier -ge [double]$cheat.body.crashPoint) { throw 'paid at/above crash point' }
$won += [double]$cheat.body.payout

Write-Host '== re-cash the same round (must be rejected) =='
$again = Send-JsonStatus "$base/game/aviator/cashout" @{ roundId = $round.roundId } $token
if ($again.code -ne 409 -or $again.body.error.code -ne 'ROUND_ALREADY_SETTLED') { throw 'expected ROUND_ALREADY_SETTLED' }

Write-Host '== a second round while flying (must be rejected) =='
$live = Send-JsonStatus "$base/game/aviator/start" @{ betAmount = 5 } $token
$spent += 5
$blocked = Send-JsonStatus "$base/game/aviator/start" @{ betAmount = 5 } $token
"second start -> $($blocked.code) $($blocked.body.error.code)"
if ($blocked.code -ne 409 -or $blocked.body.error.code -ne 'ROUND_IN_PROGRESS') { throw 'expected ROUND_IN_PROGRESS' }

Write-Host '== forfeit the live round =='
$crash = Send-JsonStatus "$base/game/aviator/crash" @{ roundId = $live.body.roundId } $token
"status=$($crash.body.status) crashPoint=$($crash.body.crashPoint) payout=$($crash.body.payout)"
if ($crash.body.status -ne 'crashed' -or [double]$crash.body.payout -ne 0) { throw 'forfeit must not pay' }

Write-Host '== late cash-out on a short round must lose =='
$short = $null
for ($i = 0; $i -lt 15; $i++) {
  $candidate = Send-JsonStatus "$base/game/aviator/start" @{ betAmount = 5 } $token
  $spent += 5
  if ([int]$candidate.body.durationMs -lt 2500) {
    $short = $candidate.body
    break
  }
  Send-JsonStatus "$base/game/aviator/crash" @{ roundId = $candidate.body.roundId } $token | Out-Null
}
if ($short) {
  "short round duration=$($short.durationMs)ms"
  Start-Sleep -Milliseconds ([int]$short.durationMs + 250)
  $late = Send-JsonStatus "$base/game/aviator/cashout" @{ roundId = $short.roundId; multiplier = 1.5 } $token
  "late cash-out -> status=$($late.body.status) payout=$($late.body.payout) crashPoint=$($late.body.crashPoint)"
  if ($late.body.status -ne 'crashed') { throw 'late cash-out must be a loss' }
  if ([double]$late.body.payout -ne 0) { throw 'late cash-out paid money' }
} else {
  Write-Host '  (no short round found in 15 tries - skipped)'
}

Write-Host '== validation =='
$bad = Send-JsonStatus "$base/game/aviator/start" @{ betAmount = 0 } $token
$unknown = Send-JsonStatus "$base/game/aviator/cashout" @{ roundId = '00000000-0000-0000-0000-000000000000' } $token
$anon = & curl.exe -s -o NUL -w '%{http_code}' -X POST "$base/game/aviator/start" -H 'Content-Type: application/json' -d '{\"betAmount\":1}'
"bet0=$($bad.code)/$($bad.body.error.code) unknownRound=$($unknown.code)/$($unknown.body.error.code) anon=$anon"

Write-Host '== ledger =='
$expected = [math]::Round(300 - $spent + $won, 2)
$bal = Get-Json "$base/wallet/balance" $token
"expected=$expected reported=$($bal.balance) spent=$spent won=$won"
if ([math]::Abs([double]$bal.balance - $expected) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'

