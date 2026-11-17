$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

# PowerShell rewrites quotes in native args, so JSON bodies go through a file.
function Send-Json([string]$url, $body, [string]$token) {
  $path = Join-Path $env:TEMP ('tp_' + [guid]::NewGuid().ToString('N') + '.json')
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

# --- an independent Teen Patti evaluator (A high, A-2-3 lowest run) ---------
$RankOf = @{
  '2' = 2; '3' = 3; '4' = 4; '5' = 5; '6' = 6; '7' = 7; '8' = 8; '9' = 9;
  'T' = 10; 'J' = 11; 'Q' = 12; 'K' = 13; 'A' = 14
}

function Get-Score([string[]]$cards) {
  if ($cards.Count -ne 3) { throw "hand must have 3 cards, got $($cards.Count)" }

  $values = @($cards | ForEach-Object {
      $rank = $_.Substring(0, $_.Length - 1)
      if (-not $RankOf.ContainsKey($rank)) { throw "bad rank '$rank'" }
      $RankOf[$rank]
    } | Sort-Object -Descending)

  $high = $values[0]; $mid = $values[1]; $low = $values[2]
  $suits = @($cards | ForEach-Object { $_.Substring($_.Length - 1) })
  $flush = ($suits[0] -eq $suits[1]) -and ($suits[1] -eq $suits[2])

  $trail = $high -eq $low
  $pair = (-not $trail) -and (($high -eq $mid) -or ($mid -eq $low))

  $runHigh = 0
  if (-not $trail -and -not $pair) {
    if ($high -eq 14 -and $mid -eq 3 -and $low -eq 2) { $runHigh = 3 }
    elseif (($high -eq $mid + 1) -and ($mid -eq $low + 1)) { $runHigh = $high }
  }

  if ($trail) { return @(6, $high, 0, 0) }
  if ($runHigh -gt 0 -and $flush) { return @(5, $runHigh, 0, 0) }
  if ($runHigh -gt 0) { return @(4, $runHigh, 0, 0) }
  if ($flush) { return @(3, $high, $mid, $low) }
  if ($pair) {
    $pairRank = if ($high -eq $mid) { $high } else { $mid }
    $kicker = if ($high -eq $mid) { $low } else { $high }
    return @(2, $pairRank, $kicker, 0)
  }
  return @(1, $high, $mid, $low)
}

function Compare-Score($a, $b) {
  for ($i = 0; $i -lt 4; $i++) {
    if ($a[$i] -ne $b[$i]) { if ($a[$i] -gt $b[$i]) { return 1 } else { return -1 } }
  }
  return 0
}

$categoryName = @{
  6 = 'trail'; 5 = 'pureSequence'; 4 = 'sequence'; 3 = 'colour'; 2 = 'pair'; 1 = 'high'
}

$phone = '9' + (Get-Random -Minimum 100000000 -Maximum 999999999)
$creds = @{ phone = $phone; password = 'TeenPattiTest1!' }

Write-Host '== register / login / deposit =='
Send-Json "$base/auth/register" $creds | Out-Null
$login = Send-Json "$base/auth/login" $creds
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send-Json "$base/wallet/deposit" @{ amount = 200 } $token | Out-Null

Write-Host '== config =='
$cfg = Get-Json "$base/game/teenpatti/config" $token
"deck=$($cfg.deckSize) hand=$($cfg.handSize) win=$($cfg.winMultiplier)x rake=$($cfg.rake) pays=$($cfg.payoutMultiplier)x tieRefunds=$($cfg.tieRefunds)"
"ranking: $(($cfg.ranking | ForEach-Object { $_.label }) -join ' > ')"
"odds: hands=$($cfg.odds.hands) tiePairs=$($cfg.odds.tiePairs) P(tie)=$($cfg.odds.tieRate) RTP=$($cfg.odds.rtp) edge=$($cfg.odds.houseEdge) noRakeRTP=$($cfg.odds.rtpWithoutRake)"

if ($cfg.deckSize -ne 52 -or $cfg.handSize -ne 3) { throw 'unexpected deck/hand size' }
if ([double]$cfg.winMultiplier -ne 2 -or [double]$cfg.rake -ne 0.05 -or [double]$cfg.payoutMultiplier -ne 1.95) {
  throw 'unexpected payout configuration'
}
if (-not $cfg.tieRefunds) { throw 'a tie must refund the stake' }

$rankingText = ($cfg.ranking | ForEach-Object { $_.id }) -join ','
if ($rankingText -ne 'trail,pureSequence,sequence,colour,pair,high') {
  throw "unexpected ranking order: $rankingText"
}

# Exact enumeration (see backend/scripts/verify-teenpatti.cjs).
if ([int]$cfg.odds.hands -ne 22100) { throw "hands $($cfg.odds.hands) != 22100" }
if ([int]$cfg.odds.tiePairs -ne 450528) { throw "tiePairs $($cfg.odds.tiePairs) != 450528" }
if ([math]::Abs([double]$cfg.odds.rtp - 0.975) -gt 0.0001) { throw "RTP $($cfg.odds.rtp) != 0.975" }
if ([math]::Abs([double]$cfg.odds.rtpWithoutRake - 1) -gt 0.000001) {
  throw "the literal 2x table must be exactly break-even, got $($cfg.odds.rtpWithoutRake)"
}

Write-Host '== 80 hands at $1 =='
$balance = 200.0
$totalPaid = 0.0
$wins = @{ player = 0; dealer = 0; tie = 0 }
$categories = @{ trail = 0; pureSequence = 0; sequence = 0; colour = 0; pair = 0; high = 0 }
$payMultiplier = [double]$cfg.payoutMultiplier

for ($i = 0; $i -lt 80; $i++) {
  $r = Send-Json "$base/game/teenpatti/play" @{ betAmount = 1 } $token

  $player = @($r.playerHand)
  $dealer = @($r.dealerHand)
  if ($player.Count -ne 3 -or $dealer.Count -ne 3) {
    throw "hand ${i}: expected 3+3 cards, got $($player.Count)+$($dealer.Count)"
  }

  # One deck — no card may appear twice across the two hands.
  $all = @($player + $dealer)
  if (@($all | Sort-Object -Unique).Count -ne 6) {
    throw "hand ${i}: duplicate card dealt ($($all -join ','))"
  }

  $playerScore = Get-Score $player
  $dealerScore = Get-Score $dealer
  $playerCategory = $categoryName[$playerScore[0]]
  $dealerCategory = $categoryName[$dealerScore[0]]

  if ($r.playerCategory -ne $playerCategory) {
    throw "hand ${i}: player category $($r.playerCategory) != $playerCategory [$($player -join ' ')]"
  }
  if ($r.dealerCategory -ne $dealerCategory) {
    throw "hand ${i}: dealer category $($r.dealerCategory) != $dealerCategory [$($dealer -join ' ')]"
  }

  $comparison = Compare-Score $playerScore $dealerScore
  $wantWinner = if ($comparison -gt 0) { 'player' } elseif ($comparison -lt 0) { 'dealer' } else { 'tie' }
  if ($r.winner -ne $wantWinner) {
    throw "hand ${i}: winner $($r.winner) != $wantWinner ($playerCategory vs $dealerCategory)"
  }

  $wantWon = $wantWinner -eq 'player'
  $wantPush = $wantWinner -eq 'tie'
  $wantOutcome = if ($wantWon) { 'won' } elseif ($wantPush) { 'push' } else { 'lost' }
  $wantMult = if ($wantWon) { $payMultiplier } elseif ($wantPush) { 1 } else { 0 }
  $wantPayout = [math]::Round(1 * $wantMult, 2)

  if ($r.outcome -ne $wantOutcome) {
    throw "hand ${i}: outcome $($r.outcome) != $wantOutcome"
  }
  if ([math]::Abs([double]$r.multiplier - [double]$wantMult) -gt 0.0001) {
    throw "hand ${i}: multiplier $($r.multiplier) != $wantMult"
  }
  if ([math]::Abs([double]$r.payout - [double]$wantPayout) -gt 0.001) {
    throw "hand ${i}: payout $($r.payout) != $wantPayout"
  }

  $wins[$wantWinner] = $wins[$wantWinner] + 1
  $categories[$playerCategory] = $categories[$playerCategory] + 1
  $categories[$dealerCategory] = $categories[$dealerCategory] + 1

  $balance = [math]::Round($balance - 1 + [double]$r.payout, 2)
  if ([math]::Abs([double]$r.balanceAfter - $balance) -gt 0.001) {
    throw "hand ${i}: balance drift (got $($r.balanceAfter) want $balance)"
  }
  $totalPaid += [double]$r.payout

  if ($i -lt 6) {
    "hand {0,2} | P {1,-12} [{2}] vs D {3,-12} [{4}] | {5} | {6} {7}x paid {8}" -f `
      $i, $playerCategory, ($player -join ' '), $dealerCategory, ($dealer -join ' '), $r.winner, $r.outcome, $r.multiplier, $r.payout
  }
}

"winners over 80 hands: player=$($wins.player) dealer=$($wins.dealer) tie=$($wins.tie)"
"dealt categories: $(($categories.GetEnumerator() | ForEach-Object { $_.Key + '=' + $_.Value }) -join ' ')"

Write-Host '== balance =='
$bal = Get-Json "$base/wallet/balance" $token
"expected=$balance reported=$($bal.balance) total_paid=$totalPaid"
if ([math]::Abs([double]$bal.balance - $balance) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host '== validation =='
Send-Json "$base/game/teenpatti/play" @{ betAmount = 0 } $token | ConvertTo-Json -Compress
Send-Json "$base/game/teenpatti/play" @{ betAmount = -5 } $token | ConvertTo-Json -Compress
Send-Json "$base/game/teenpatti/play" @{ betAmount = 'abc' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/teenpatti/play" @{ betAmount = 5000 } $token | ConvertTo-Json -Compress
& curl.exe -s -o NUL -w "unauthenticated_status=%{http_code}`n" -X POST "$base/game/teenpatti/play" -H 'Content-Type: application/json' -d '{\"betAmount\":1}'

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'
