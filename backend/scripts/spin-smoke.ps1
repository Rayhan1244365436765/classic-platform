$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

# PowerShell rewrites quotes in native args, so JSON bodies go through a file.
function Send-Json([string]$url, $body, [string]$token) {
  $path = Join-Path $env:TEMP ('spin_' + [guid]::NewGuid().ToString('N') + '.json')
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
$creds = @{ phone = $phone; password = 'SpinTest123!' }

Write-Host '== register =='
Send-Json "$base/auth/register" $creds | ConvertTo-Json -Compress

Write-Host '== login =='
$login = Send-Json "$base/auth/login" $creds
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id) role=$($login.user.role)"

Write-Host '== deposit 100 =='
Send-Json "$base/wallet/deposit" @{ amount = 100 } $token | ConvertTo-Json -Compress

Write-Host '== wheel config =='
$cfg = Get-Json "$base/game/roulette/segments" $token
"segments=$($cfg.segments.Count) rtp=$($cfg.rtp) houseEdge=$([math]::Round(1 - $cfg.rtp, 2))"
$cfg.payouts | ForEach-Object { "  $($_.multiplier)x color=$($_.color) chance=$($_.chance)" }

Write-Host '== single spin, bet 5 =='
$one = Send-Json "$base/game/roulette/play" @{ betAmount = 5 } $token
$one | ConvertTo-Json -Compress
if ([double]$one.payout -ne [math]::Round(5 * $one.multiplier, 2)) { throw 'payout != bet * multiplier' }

Write-Host '== 40 spins, bet 1 each =='
$expected = [math]::Round(100 - 5 + [double]$one.payout, 2)
$dist = @{}
$wins = 0
$lastBalance = 0
for ($i = 0; $i -lt 40; $i++) {
  $r = Send-Json "$base/game/roulette/play" @{ betAmount = 1 } $token
  $key = "$($r.multiplier)"
  if ($dist.ContainsKey($key)) { $dist[$key]++ } else { $dist[$key] = 1 }
  if ($r.won) { $wins++ }
  if ([double]$r.payout -ne [math]::Round(1 * $r.multiplier, 2)) {
    throw "payout mismatch: mult=$($r.multiplier) payout=$($r.payout)"
  }
  if ($r.segmentIndex -lt 0 -or $r.segmentIndex -gt 19) { throw 'segmentIndex out of range' }
  $expected = [math]::Round($expected - 1 + [double]$r.payout, 2)
  $lastBalance = [double]$r.balanceAfter
}
"wins=$wins/40 distribution=$($dist | ConvertTo-Json -Compress)"
"expected=$expected lastReportedBalance=$lastBalance"
if ([math]::Abs($lastBalance - $expected) -gt 0.001) { throw 'running balance drift' }

Write-Host '== balance endpoint =='
$bal = Get-Json "$base/wallet/balance" $token
"balance=$($bal.balance)"
if ([math]::Abs([double]$bal.balance - $expected) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host '== validation =='
Send-Json "$base/game/roulette/play" @{ betAmount = 0 } $token | ConvertTo-Json -Compress
Send-Json "$base/game/roulette/play" '{}' $token | ConvertTo-Json -Compress
& curl.exe -s -o NUL -w "unauthenticated_status=%{http_code}`n" -X POST "$base/game/roulette/play" -H 'Content-Type: application/json' -d '{\"betAmount\":1}'

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'
