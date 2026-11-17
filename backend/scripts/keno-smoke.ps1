$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

# PowerShell rewrites quotes in native args, so JSON bodies go through a file.
function Send-Json([string]$url, $body, [string]$token) {
  $path = Join-Path $env:TEMP ('keno_' + [guid]::NewGuid().ToString('N') + '.json')
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
$creds = @{ phone = $phone; password = 'KenoTest123!' }

Write-Host '== register / login / deposit =='
Send-Json "$base/auth/register" $creds | Out-Null
$login = Send-Json "$base/auth/login" $creds
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send-Json "$base/wallet/deposit" @{ amount = 200 } $token | Out-Null

Write-Host '== config =='
$cfg = Get-Json "$base/game/keno/config" $token
"pool=$($cfg.pool) drawn=$($cfg.drawn) picks=$($cfg.minPicks)-$($cfg.maxPicks) ladders=$($cfg.payTables.Count)"
if ($cfg.pool -ne 80 -or $cfg.drawn -ne 20 -or $cfg.maxPicks -ne 10) { throw 'unexpected keno config' }
if ($cfg.payTables.Count -ne 10) { throw 'expected 10 pay ladders' }

# The ladders the service derives (see backend/scripts/verify-keno.cjs).
$expected = @{
  1  = @(3.88)
  2  = @(1.73, 5.19)
  3  = @(5.37, 16.13)
  4  = @(2.62, 7.86, 23.59)
  5  = @(1.49, 4.48, 13.46, 40.38)
  6  = @(3.93, 11.79, 35.37, 106.12)
  7  = @(2.25, 6.75, 20.25, 60.75, 182.27)
  8  = @(1.38, 4.14, 12.43, 37.3, 111.92, 335.78)
  9  = @(3.43, 10.31, 30.93, 92.81, 278.44, 835.32)
  10 = @(2.1, 6.31, 18.93, 56.81, 170.45, 511.35, 1534.05)
}

foreach ($table in $cfg.payTables) {
  $want = $expected[[int]$table.picks]
  $got = @($table.multipliers | Select-Object -Skip $table.minHits)
  $gotText = ($got | ForEach-Object { [double]$_ }) -join ','
  $wantText = ($want | ForEach-Object { [double]$_ }) -join ','
  if ($gotText -ne $wantText) {
    throw "ladder mismatch for $($table.picks) picks: got [$gotText] want [$wantText]"
  }
  # Nothing below the threshold may pay.
  for ($h = 0; $h -lt $table.minHits; $h++) {
    if ([double]$table.multipliers[$h] -ne 0) { throw "picks $($table.picks): hits $h must pay 0" }
  }
  if ([double]$table.rtp -lt 0.96 -or [double]$table.rtp -gt 0.9701) {
    throw "picks $($table.picks): RTP out of range ($($table.rtp))"
  }
  "picks {0,2} | from {1} | {2} | RTP {3:P2}" -f $table.picks, $table.minHits, ($got -join ', '), [double]$table.rtp
}

Write-Host '== 10 draws at $1 (one per pick count) =='
$balance = 200.0
$total = 0.0
foreach ($picks in 1..10) {
  $numbers = @(1..$picks)
  $r = Send-Json "$base/game/keno/play" @{ betAmount = 1; selectedNumbers = $numbers } $token

  if ($r.drawn.Count -ne 20) { throw "picks ${picks}: expected 20 drawn, got $($r.drawn.Count)" }
  $unique = @($r.drawn | Sort-Object -Unique)
  if ($unique.Count -ne 20) { throw "picks ${picks}: drawn numbers are not unique" }
  foreach ($n in $r.drawn) {
    if ([int]$n -lt 1 -or [int]$n -gt 80) { throw "picks ${picks}: drawn number out of range ($n)" }
  }
  if (@($r.picked).Count -ne $picks) { throw "picks ${picks}: picked echoed wrong" }

  # Hits must be exactly the intersection of the picks and the draw.
  $wantMatches = @($numbers | Where-Object { $r.drawn -contains $_ })
  if ([int]$r.hits -ne $wantMatches.Count) {
    throw "picks ${picks}: hits $($r.hits) != $($wantMatches.Count)"
  }
  if (@($r.matches).Count -ne $wantMatches.Count) { throw "picks ${picks}: matches array mismatch" }

  $ladder = $expected[$picks]
  $minHits = @($cfg.payTables | Where-Object { $_.picks -eq $picks })[0].minHits
  $wantMult = if ($wantMatches.Count -lt $minHits) { 0 } else { $ladder[$wantMatches.Count - $minHits] }
  $wantPayout = [math]::Round(1 * $wantMult, 2)

  if ([math]::Abs([double]$r.multiplier - [double]$wantMult) -gt 0.0001) {
    throw "picks ${picks}: multiplier $($r.multiplier) != $wantMult (hits $($r.hits))"
  }
  if ([math]::Abs([double]$r.payout - [double]$wantPayout) -gt 0.001) {
    throw "picks ${picks}: payout $($r.payout) != $wantPayout"
  }

  $balance = [math]::Round($balance - 1 + [double]$r.payout, 2)
  if ([math]::Abs([double]$r.balanceAfter - $balance) -gt 0.001) {
    throw "picks ${picks}: balance drift (got $($r.balanceAfter) want $balance)"
  }
  $total += [double]$r.payout

  "picks {0,2} | hits {1} | {2}x | paid {3} | drawn [{4} ...]" -f `
    $picks, $r.hits, $r.multiplier, $r.payout, (($r.drawn | Select-Object -First 8) -join ' ')
}

Write-Host '== balance =='
$bal = Get-Json "$base/wallet/balance" $token
"expected=$balance reported=$($bal.balance) total_paid=$total"
if ([math]::Abs([double]$bal.balance - $balance) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host '== validation =='
Send-Json "$base/game/keno/play" @{ betAmount = 1; selectedNumbers = @() } $token | ConvertTo-Json -Compress
Send-Json "$base/game/keno/play" @{ betAmount = 1; selectedNumbers = @(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11) } $token | ConvertTo-Json -Compress
Send-Json "$base/game/keno/play" @{ betAmount = 1; selectedNumbers = @(4, 4) } $token | ConvertTo-Json -Compress
Send-Json "$base/game/keno/play" @{ betAmount = 1; selectedNumbers = @(0, 81) } $token | ConvertTo-Json -Compress
Send-Json "$base/game/keno/play" @{ betAmount = 1; selectedNumbers = '1,2,3' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/keno/play" @{ betAmount = 0; selectedNumbers = @(1) } $token | ConvertTo-Json -Compress
Send-Json "$base/game/keno/play" @{ betAmount = 5000; selectedNumbers = @(1) } $token | ConvertTo-Json -Compress
& curl.exe -s -o NUL -w "unauthenticated_status=%{http_code}`n" -X POST "$base/game/keno/play" -H 'Content-Type: application/json' -d '{\"betAmount\":1,\"selectedNumbers\":[1,2,3]}'

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'
