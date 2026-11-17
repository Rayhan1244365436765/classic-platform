$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

# PowerShell rewrites quotes in native args, so JSON bodies go through a file.
function Send-Json([string]$url, $body, [string]$token) {
  $path = Join-Path $env:TEMP ('dt_' + [guid]::NewGuid().ToString('N') + '.json')
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

# Dragon Tiger ranks: A = 1 … K = 13.
function Card-Rank([string]$card) {
  $rank = $card.Substring(0, $card.Length - 1)
  if ($card.Length -ne 2) { throw "bad card code '$card'" }
  switch ($rank) {
    'A' { return 1 }
    'T' { return 10 }
    'J' { return 11 }
    'Q' { return 12 }
    'K' { return 13 }
    default {
      $value = 0
      if (-not [int]::TryParse($rank, [ref]$value)) { throw "bad rank '$rank'" }
      if ($value -lt 2 -or $value -gt 9) { throw "rank out of range '$rank'" }
      return $value
    }
  }
}

$phone = '9' + (Get-Random -Minimum 100000000 -Maximum 999999999)
$creds = @{ phone = $phone; password = 'DragonTiger1!' }

Write-Host '== register / login / deposit =='
Send-Json "$base/auth/register" $creds | Out-Null
$login = Send-Json "$base/auth/login" $creds
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send-Json "$base/wallet/deposit" @{ amount = 200 } $token | Out-Null

Write-Host '== config =='
$cfg = Get-Json "$base/game/dragontiger/config" $token
"decks=$($cfg.decks) shoe=$($cfg.shoeSize) tieLosesSides=$($cfg.tieLosesSides)"
"payouts: dragon=$($cfg.payouts.dragon) tiger=$($cfg.payouts.tiger) tie=$($cfg.payouts.tie)"
"P(dragon)=$($cfg.probabilities.dragon) P(tiger)=$($cfg.probabilities.tiger) P(tie)=$($cfg.probabilities.tie)"
"rtp: dragon=$($cfg.rtp.dragon) tiger=$($cfg.rtp.tiger) tie=$($cfg.rtp.tie)"

if ($cfg.decks -ne 8 -or $cfg.shoeSize -ne 416) { throw 'unexpected shoe' }
if ([double]$cfg.payouts.dragon -ne 2 -or [double]$cfg.payouts.tiger -ne 2 -or [double]$cfg.payouts.tie -ne 8) {
  throw 'unexpected payouts'
}
if (-not $cfg.tieLosesSides) { throw 'a tie must lose dragon/tiger bets' }

$mass = [double]$cfg.probabilities.dragon + [double]$cfg.probabilities.tiger + [double]$cfg.probabilities.tie
"probability mass = $mass"
if ([math]::Abs($mass - 1) -gt 0.000001) { throw 'probabilities do not sum to 1' }
if ([math]::Abs([double]$cfg.probabilities.dragon - [double]$cfg.probabilities.tiger) -gt 1e-12) {
  throw 'dragon and tiger must be symmetric'
}

# Exact values for the 8-deck shoe (see backend/scripts/verify-dragontiger.cjs).
$expectedTie = 0.074699
if ([math]::Abs([double]$cfg.probabilities.tie - $expectedTie) -gt 0.000001) {
  throw "P(tie) $($cfg.probabilities.tie) != $expectedTie"
}

$expectedRtp = @{ dragon = 0.9253; tiger = 0.9253; tie = 0.5976 }
foreach ($side in @('dragon', 'tiger', 'tie')) {
  if ([math]::Abs([double]$cfg.rtp.$side - $expectedRtp[$side]) -gt 0.0001) {
    throw "rtp mismatch for $side (got $($cfg.rtp.$side) want $($expectedRtp[$side]))"
  }
}

Write-Host '== 60 hands at $1 (dragon / tiger / tie rotating) =='
$balance = 200.0
$totalPaid = 0.0
$wins = @{ dragon = 0; tiger = 0; tie = 0 }
$payouts = @{ dragon = 2; tiger = 2; tie = 8 }
$sides = @('dragon', 'tiger', 'tie')
$sampleShown = 0

for ($i = 0; $i -lt 60; $i++) {
  $side = $sides[$i % 3]
  $r = Send-Json "$base/game/dragontiger/play" @{ betAmount = 1; betOn = $side } $token

  if ($r.betOn -ne $side) { throw "hand ${i}: betOn echoed wrong" }

  $dragonRank = Card-Rank $r.dragonCard
  $tigerRank = Card-Rank $r.tigerCard
  if ([int]$r.dragonRank -ne $dragonRank) {
    throw "hand ${i}: dragonRank $($r.dragonRank) != $dragonRank ($($r.dragonCard))"
  }
  if ([int]$r.tigerRank -ne $tigerRank) {
    throw "hand ${i}: tigerRank $($r.tigerRank) != $tigerRank ($($r.tigerCard))"
  }

  $wantWinner = if ($dragonRank -gt $tigerRank) { 'dragon' } elseif ($tigerRank -gt $dragonRank) { 'tiger' } else { 'tie' }
  if ($r.winner -ne $wantWinner) {
    throw "hand ${i}: winner $($r.winner) != $wantWinner ($($r.dragonCard) vs $($r.tigerCard))"
  }

  # Tie loses dragon/tiger; only the tie bet collects.
  $wantWon = $wantWinner -eq $side
  $wantMult = if ($wantWon) { $payouts[$side] } else { 0 }
  $wantOutcome = if ($wantWon) { 'won' } else { 'lost' }
  $wantPayout = [math]::Round(1 * $wantMult, 2)

  if ($r.outcome -ne $wantOutcome) {
    throw "hand ${i}: outcome $($r.outcome) != $wantOutcome (backed $side, winner $($r.winner))"
  }
  if ([math]::Abs([double]$r.multiplier - [double]$wantMult) -gt 0.0001) {
    throw "hand ${i}: multiplier $($r.multiplier) != $wantMult"
  }
  if ([math]::Abs([double]$r.payout - [double]$wantPayout) -gt 0.001) {
    throw "hand ${i}: payout $($r.payout) != $wantPayout"
  }
  if ($wantWinner -eq 'tie' -and $side -ne 'tie' -and [double]$r.payout -ne 0) {
    throw "hand ${i}: a tie must pay nothing to dragon/tiger"
  }

  $wins[$wantWinner] = $wins[$wantWinner] + 1

  $balance = [math]::Round($balance - 1 + [double]$r.payout, 2)
  if ([math]::Abs([double]$r.balanceAfter - $balance) -gt 0.001) {
    throw "hand ${i}: balance drift (got $($r.balanceAfter) want $balance)"
  }
  $totalPaid += [double]$r.payout

  if ($sampleShown -lt 6) {
    "hand {0,2} | noted {1,-6} | D {2,2} ({3}) vs T {4,2} ({5}) | {6} won | {7} {8}x paid {9}" -f `
      $i, $side, $dragonRank, $r.dragonCard, $tigerRank, $r.tigerCard, $r.winner, $r.outcome, $r.multiplier, $r.payout
    $sampleShown++
  }
}

"winners over 60 hands: dragon=$($wins.dragon) tiger=$($wins.tiger) tie=$($wins.tie)"

Write-Host '== balance =='
$bal = Get-Json "$base/wallet/balance" $token
"expected=$balance reported=$($bal.balance) total_paid=$totalPaid"
if ([math]::Abs([double]$bal.balance - $balance) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host '== validation =='
Send-Json "$base/game/dragontiger/play" @{ betAmount = 1; betOn = 'both' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/dragontiger/play" @{ betAmount = 1 } $token | ConvertTo-Json -Compress
Send-Json "$base/game/dragontiger/play" @{ betAmount = 0; betOn = 'dragon' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/dragontiger/play" @{ betAmount = 5000; betOn = 'tie' } $token | ConvertTo-Json -Compress
& curl.exe -s -o NUL -w "unauthenticated_status=%{http_code}`n" -X POST "$base/game/dragontiger/play" -H 'Content-Type: application/json' -d '{\"betAmount\":1,\"betOn\":\"dragon\"}'

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'
