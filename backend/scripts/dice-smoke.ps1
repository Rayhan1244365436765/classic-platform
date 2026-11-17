$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

# PowerShell rewrites quotes in native args, so JSON bodies go through a file.
function Send-Json([string]$url, $body, [string]$token) {
  $path = Join-Path $env:TEMP ('dice_' + [guid]::NewGuid().ToString('N') + '.json')
  $text = if ($body -is [string]) { $body } else { $body | ConvertTo-Json -Compress }
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
  $curlArgs = @('-s', '-X', 'POST', $url, '-H', 'Content-Type: application/json', '-d', "@$path")
  if ($token) { $curlArgs += @('-H', "Authorization: Bearer $token") }
  $raw = (& curl.exe @curlArgs | Out-String)
  Remove-Item -LiteralPath $path -Force
  return ($raw | ConvertFrom-Json)
}

function Get-Json([string]$url, [string]$token) {
  $raw = (& curl.exe -s $url -H "Authorization: Bearer $token" | Out-String)
  return ($raw | ConvertFrom-Json)
}

$phone = '9' + (Get-Random -Minimum 100000000 -Maximum 999999999)
$creds = @{ phone = $phone; password = 'DiceTest123!' }

Write-Host '== register / login / deposit =='
Send-Json "$base/auth/register" $creds | Out-Null
$login = Send-Json "$base/auth/login" $creds
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send-Json "$base/wallet/deposit" @{ amount = 200 } $token | Out-Null

Write-Host '== config =='
$cfg = Get-Json "$base/game/dice/config" $token
"faces=$($cfg.faces) multiplier=$($cfg.multiplier) house=$($cfg.houseNumber) high=$($cfg.high.min)-$($cfg.high.max) low=$($cfg.low.min)-$($cfg.low.max)"
if ($cfg.multiplier -ne 1.95 -or $cfg.houseNumber -ne 50) { throw 'unexpected dice config' }

Write-Host '== 40 rolls at $1 (20 high / 20 low, alternating) =='
$expected = 200.0
$stats = @{ high = @{ win = 0; lose = 0 }; low = @{ win = 0; lose = 0 } }
$rolls = @()
for ($i = 0; $i -lt 40; $i++) {
  $side = if ($i % 2 -eq 0) { 'high' } else { 'low' }
  $r = Send-Json "$base/game/dice/play" @{ betAmount = 1; prediction = $side } $token

  if ([int]$r.roll -lt 1 -or [int]$r.roll -gt 100) { throw "roll out of range: $($r.roll)" }
  if ($r.prediction -ne $side) { throw "prediction echoed wrong: $($r.prediction)" }

  $wantWon = if ($side -eq 'high') { [int]$r.roll -gt 50 } else { [int]$r.roll -lt 50 }
  if ($r.won -ne $wantWon) { throw "won mismatch on/$side roll $($r.roll)" }

  # 50 must lose for both sides.
  if ([int]$r.roll -eq 50 -and $r.won) { throw 'roll 50 must lose' }

  $wantPayout = if ($wantWon) { [math]::Round(1 * 1.95, 2) } else { 0 }
  if ([double]$r.payout -ne $wantPayout) { throw "payout mismatch: got $($r.payout) want $wantPayout" }
  $wantMult = if ($wantWon) { 1.95 } else { 0 }
  if ([double]$r.multiplier -ne $wantMult) { throw "multiplier mismatch: got $($r.multiplier)" }

  $key = if ($wantWon) { 'win' } else { 'lose' }
  $stats[$side][$key] = $stats[$side][$key] + 1
  $rolls += [int]$r.roll

  $expected = [math]::Round($expected - 1 + [double]$r.payout, 2)
  if ([math]::Abs([double]$r.balanceAfter - $expected) -gt 0.001) { throw "balance drift on roll $i" }
}
$sorted = ($rolls | Sort-Object) -join ' '
"high: $($stats.high.win)W/$($stats.high.lose)L   low: $($stats.low.win)W/$($stats.low.lose)L"
"rolls: $sorted"

Write-Host '== balance =='
$bal = Get-Json "$base/wallet/balance" $token
"expected=$expected reported=$($bal.balance)"
if ([math]::Abs([double]$bal.balance - $expected) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host '== validation =='
Send-Json "$base/game/dice/play" @{ betAmount = 1; prediction = 'middle' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/dice/play" @{ betAmount = 0; prediction = 'high' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/dice/play" @{ betAmount = 1 } $token | ConvertTo-Json -Compress
& curl.exe -s -o NUL -w "unauthenticated_status=%{http_code}`n" -X POST "$base/game/dice/play" -H 'Content-Type: application/json' -d '{\"betAmount\":1,\"prediction\":\"high\"}'

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'
