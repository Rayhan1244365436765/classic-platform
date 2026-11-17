$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

# PowerShell rewrites quotes in native args, so JSON bodies go through a file.
function Send-Json([string]$url, $body, [string]$token) {
  $path = Join-Path $env:TEMP ('bac_' + [guid]::NewGuid().ToString('N') + '.json')
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

# A = 1, 2-9 face, T/J/Q/K = 0.
function Card-Value([string]$card) {
  $rank = $card.Substring(0, $card.Length - 1)
  if ($rank -eq 'A') { return 1 }
  if ($rank -eq 'T' -or $rank -eq 'J' -or $rank -eq 'Q' -or $rank -eq 'K') { return 0 }
  return [int]$rank
}

function Hand-Total([string[]]$cards) {
  $sum = 0
  foreach ($card in $cards) { $sum += (Card-Value $card) }
  return $sum % 10
}

# Standard banker tableau; $third is $null when the player stood.
function Banker-Draws([int]$bankerTotal, $third) {
  if ($null -eq $third) { return $bankerTotal -le 5 }
  if ($bankerTotal -le 2) { return $true }
  if ($bankerTotal -eq 3) { return $third -ne 8 }
  if ($bankerTotal -eq 4) { return ($third -ge 2 -and $third -le 7) }
  if ($bankerTotal -eq 5) { return ($third -ge 4 -and $third -le 7) }
  if ($bankerTotal -eq 6) { return ($third -eq 6 -or $third -eq 7) }
  return $false
}

$phone = '9' + (Get-Random -Minimum 100000000 -Maximum 999999999)
$creds = @{ phone = $phone; password = 'BaccaratTest1!' }

Write-Host '== register / login / deposit =='
Send-Json "$base/auth/register" $creds | Out-Null
$login = Send-Json "$base/auth/login" $creds
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send-Json "$base/wallet/deposit" @{ amount = 200 } $token | Out-Null

Write-Host '== config =='
$cfg = Get-Json "$base/game/baccarat/config" $token
"deck=$($cfg.deckSize) natural=$($cfg.naturalTotal) playerDrawsAt=$($cfg.playerDrawsAt) commission=$($cfg.bankerCommission) pushOnTie=$($cfg.pushOnTie)"
"payouts: player=$($cfg.payouts.player) banker=$($cfg.payouts.banker) tie=$($cfg.payouts.tie)"
"P(player)=$($cfg.probabilities.player) P(banker)=$($cfg.probabilities.banker) P(tie)=$($cfg.probabilities.tie)"
"rtp: player=$($cfg.rtp.player) banker=$($cfg.rtp.banker) tie=$($cfg.rtp.tie)"

if ($cfg.deckSize -ne 52 -or $cfg.naturalTotal -ne 8 -or $cfg.playerDrawsAt -ne 5) { throw 'unexpected rules' }
if ([double]$cfg.payouts.player -ne 2 -or [double]$cfg.payouts.banker -ne 1.95 -or [double]$cfg.payouts.tie -ne 8) {
  throw 'unexpected payouts'
}
if (-not $cfg.pushOnTie) { throw 'a tie must push player/banker stakes' }

$mass = [double]$cfg.probabilities.player + [double]$cfg.probabilities.banker + [double]$cfg.probabilities.tie
"probability mass = $mass"
if ([math]::Abs($mass - 1) -gt 0.000001) { throw 'probabilities do not sum to 1' }

# Exact enumeration values (see backend/scripts/verify-baccarat.cjs).
$expectedRtp = @{ player = 0.9871; banker = 0.9899; tie = 0.7489 }
foreach ($side in @('player', 'banker', 'tie')) {
  if ([math]::Abs([double]$cfg.rtp.$side - $expectedRtp[$side]) -gt 0.0001) {
    throw "rtp mismatch for $side (got $($cfg.rtp.$side) want $($expectedRtp[$side]))"
  }
}

Write-Host '== 45 hands at $1 (player / banker / tie rotating) =='
$balance = 200.0
$totalPaid = 0.0
$stats = @{ player = 0; banker = 0; tie = 0 }
$payouts = @{ player = 2; banker = 1.95; tie = 8 }
$sides = @('player', 'banker', 'tie')

for ($i = 0; $i -lt 45; $i++) {
  $side = $sides[$i % 3]
  $r = Send-Json "$base/game/baccarat/play" @{ betAmount = 1; betOn = $side } $token

  $player = @($r.playerHand)
  $banker = @($r.bankerHand)
  if ($player.Count -lt 2 -or $player.Count -gt 3) { throw "hand $i (${side}): player has $($player.Count) cards" }
  if ($banker.Count -lt 2 -or $banker.Count -gt 3) { throw "hand $i (${side}): banker has $($banker.Count) cards" }

  # One deck, so no card may appear twice.
  $all = @($player + $banker)
  if (@($all | Sort-Object -Unique).Count -ne $all.Count) { throw "hand ${i}: duplicate card dealt ($($all -join ','))" }

  if ($r.betOn -ne $side) { throw "hand ${i}: betOn echoed wrong" }

  $playerTotal = Hand-Total $player
  $bankerTotal = Hand-Total $banker
  if ([int]$r.playerTotal -ne $playerTotal) {
    throw "hand ${i}: playerTotal $($r.playerTotal) != $playerTotal"
  }
  if ([int]$r.bankerTotal -ne $bankerTotal) {
    throw "hand ${i}: bankerTotal $($r.bankerTotal) != $bankerTotal"
  }

  # Third-card rules.
  $playerOpening = ((Card-Value $player[0]) + (Card-Value $player[1])) % 10
  $bankerOpening = ((Card-Value $banker[0]) + (Card-Value $banker[1])) % 10
  $natural = ($playerOpening -ge 8) -or ($bankerOpening -ge 8)

  if ([bool]$r.natural -ne $natural) {
    throw "hand ${i}: natural flag $($r.natural) != $natural (P$playerOpening B$bankerOpening)"
  }

  if ($natural) {
    if ($player.Count -ne 2 -or $banker.Count -ne 2) { throw "hand ${i}: a natural must not draw" }
  } else {
    if (($playerOpening -le 5) -ne ($player.Count -eq 3)) {
      throw "hand ${i}: player draw rule (opening $playerOpening, $($player.Count) cards)"
    }

    $third = if ($player.Count -eq 3) { Card-Value $player[2] } else { $null }
    $wantBanker = Banker-Draws $bankerOpening $third
    if ($wantBanker -ne ($banker.Count -eq 3)) {
      throw "hand ${i}: banker draw rule (opening $bankerOpening, third $(if ($null -eq $third) { 'none' } else { $third }), $($banker.Count) cards)"
    }
  }

  # Winner and settlement.
  $wantWinner = if ($playerTotal -gt $bankerTotal) { 'player' } elseif ($bankerTotal -gt $playerTotal) { 'banker' } else { 'tie' }
  if ($r.winner -ne $wantWinner) {
    throw "hand ${i}: winner $($r.winner) != $wantWinner (P$playerTotal B$bankerTotal)"
  }
  if ($wantWinner -eq 'player') { $stats.player++ } elseif ($wantWinner -eq 'banker') { $stats.banker++ } else { $stats.tie++ }

  if ($r.winner -eq $side) {
    $wantOutcome = 'won'
    $wantMult = $payouts[$side]
  } elseif ($r.winner -eq 'tie') {
    $wantOutcome = 'push'
    $wantMult = 1
  } else {
    $wantOutcome = 'lost'
    $wantMult = 0
  }

  if ($r.outcome -ne $wantOutcome) {
    throw "hand ${i}: outcome $($r.outcome) != $wantOutcome (backed $side, winner $($r.winner))"
  }
  if ([math]::Abs([double]$r.multiplier - [double]$wantMult) -gt 0.0001) {
    throw "hand ${i}: multiplier $($r.multiplier) != $wantMult"
  }

  $wantPayout = [math]::Round(1 * $wantMult, 2)
  if ([math]::Abs([double]$r.payout - $wantPayout) -gt 0.001) {
    throw "hand ${i}: payout $($r.payout) != $wantPayout"
  }

  $balance = [math]::Round($balance - 1 + [double]$r.payout, 2)
  if ([math]::Abs([double]$r.balanceAfter - $balance) -gt 0.001) {
    throw "hand ${i}: balance drift (got $($r.balanceAfter) want $balance)"
  }
  $totalPaid += [double]$r.payout

  if ($i -lt 6) {
    "hand {0,2} | noted {1,-6} | P {2} [{3}] vs B {4} [{5}] | {6} won | {7} {8}x paid {9}" -f `
      $i, $side, $playerTotal, ($player -join ' '), $bankerTotal, ($banker -join ' '), $r.winner, $r.outcome, $r.multiplier, $r.payout
  }
}

"winners over 45 hands: player=$($stats.player) banker=$($stats.banker) tie=$($stats.tie)"

Write-Host '== balance =='
$bal = Get-Json "$base/wallet/balance" $token
"expected=$balance reported=$($bal.balance) total_paid=$totalPaid"
if ([math]::Abs([double]$bal.balance - $balance) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host '== validation =='
Send-Json "$base/game/baccarat/play" @{ betAmount = 1; betOn = 'draw' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/baccarat/play" @{ betAmount = 1 } $token | ConvertTo-Json -Compress
Send-Json "$base/game/baccarat/play" @{ betAmount = 0; betOn = 'player' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/baccarat/play" @{ betAmount = 5000; betOn = 'tie' } $token | ConvertTo-Json -Compress
& curl.exe -s -o NUL -w "unauthenticated_status=%{http_code}`n" -X POST "$base/game/baccarat/play" -H 'Content-Type: application/json' -d '{\"betAmount\":1,\"betOn\":\"player\"}'

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'
