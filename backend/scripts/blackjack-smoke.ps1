$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

function Send([string]$url, $body, [string]$token) {
  $inFile = Join-Path $env:TEMP ('bj_in_' + [guid]::NewGuid().ToString('N') + '.json')
  $outFile = Join-Path $env:TEMP ('bj_out_' + [guid]::NewGuid().ToString('N') + '.json')
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
  return ((& curl.exe -s $url -H "Authorization: Bearer $token" | Out-String) | ConvertFrom-Json)
}

function Total($cards) {
  $t = 0; $aces = 0
  foreach ($c in $cards) {
    $rank = $c.Substring(0, $c.Length - 1)
    if ($rank -eq 'A') { $aces++; $t += 11 }
    elseif ('T','J','Q','K' -contains $rank) { $t += 10 }
    else { $t += [int]$rank }
  }
  while ($t -gt 21 -and $aces -gt 0) { $t -= 10; $aces-- }
  return $t
}

$phone = '9' + (Get-Random -Minimum 100000000 -Maximum 999999999)
$creds = @{ phone = $phone; password = 'BlackjackTest1!' }

Write-Host '== register / login / deposit 200 =='
Send "$base/auth/register" $creds $null | Out-Null
$login = (Send "$base/auth/login" $creds $null).body
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send "$base/wallet/deposit" @{ amount = 200 } $token | Out-Null

$spent = 0.0
$won = 0.0

Write-Host '== start: hides the hole card and the shoe =='
$start = Send "$base/game/blackjack/start" @{ betAmount = 10 } $token
if ($start.code -ne 201) { throw "start failed: $($start.code) $($start.body.error.code)" }
$hand = $start.body
$spent += 10
if ($hand.playerHand.Count -ne 2) { throw 'player must get 2 cards' }
if ($null -ne $hand.deck) { throw 'LEAK: the shoe was returned' }
if ($hand.status -eq 'active') {
  if ($hand.dealerHand.Count -ne 1) { throw 'only the dealer up-card may be shown while active' }
  if ($null -ne $hand.dealerTotal) { throw 'LEAK: dealer total exposed' }
}
if ($hand.playerTotal -ne (Total $hand.playerHand)) { throw 'player total mismatch' }
"hand=$($hand.gameId) you=$(($hand.playerHand -join ' '))=$($hand.playerTotal) dealerShows=$(($hand.dealerHand -join ' ')) status=$($hand.status) balance=$($hand.balanceAfter)"

Write-Host '== resume returns the same open hand =='
if ($hand.status -eq 'active') {
  $resume = Get-Json "$base/game/blackjack/current" $token
  if ($resume.game.gameId -ne $hand.gameId) { throw 'resume did not return the open hand' }
  "resume -> hand=$($resume.game.gameId) yourCards=$($resume.game.playerHand.Count) dealerCards=$($resume.game.dealerHand.Count)"
}

Write-Host '== second deal while a hand is open is rejected =='
$second = Send "$base/game/blackjack/start" @{ betAmount = 5 } $token
"second start -> $($second.code) $($second.body.error.code)"
if ($hand.status -eq 'active') {
  if ($second.code -ne 409 -or $second.body.error.code -ne 'GAME_IN_PROGRESS') { throw 'expected GAME_IN_PROGRESS' }
} else {
  Write-Host '  (hand was a natural, so a new deal is allowed - checking it started)'
  if ($second.code -ne 201) { throw 'expected a new hand after a natural' }
  $spent += 5
  Send "$base/game/blackjack/stand" @{ gameId = $second.body.gameId } $token | Out-Null
}

Write-Host '== play the hand out (hit while under 17, else stand) =='
$state = $hand
if ($state.status -eq 'active') {
  $guard = 0
  while ($state.status -eq 'active' -and $guard -lt 10) {
    $guard++
    if ($state.playerTotal -lt 17) {
      $state = (Send "$base/game/blackjack/hit" @{ gameId = $state.gameId } $token).body
      "hit  -> $(($state.playerHand -join ' '))=$($state.playerTotal) status=$($state.status)"
    } else {
      $state = (Send "$base/game/blackjack/stand" @{ gameId = $state.gameId } $token).body
      "stand-> dealer $(($state.dealerHand -join ' '))=$($state.dealerTotal) status=$($state.status)"
    }
  }
}
if ($state.status -eq 'active') { throw 'hand did not finish' }
$won += [double]$state.payout
"result: $($state.status) payout=$($state.payout) (you $(Total $state.playerHand) vs dealer $(Total $state.dealerHand))"
if ($state.dealerHand.Count -lt 2) { throw 'dealer must be revealed at settle' }
if ($state.dealerTotal -ne (Total $state.dealerHand)) { throw 'dealer total mismatch' }
if ((Total $state.dealerHand) -lt 17) { throw 'dealer must stand on 17+' }
if ((Total $state.playerHand) -le 21 -and $state.status -eq 'lost' -and (Total $state.dealerHand) -gt 21) {
  throw 'dealer bust must not lose'
}

Write-Host '== settled hand rejects hit/stand =='
$lateHit = Send "$base/game/blackjack/hit" @{ gameId = $state.gameId } $token
$lateStand = Send "$base/game/blackjack/stand" @{ gameId = $state.gameId } $token
"hit -> $($lateHit.code)/$($lateHit.body.error.code) stand -> $($lateStand.code)/$($lateStand.body.error.code)"
if ($lateHit.body.error.code -ne 'GAME_ALREADY_SETTLED' -or $lateStand.body.error.code -ne 'GAME_ALREADY_SETTLED') {
  throw 'expected GAME_ALREADY_SETTLED'
}

Write-Host '== 40 hands: settle maths and ledger =='
$statuses = @{}
for ($i = 0; $i -lt 40; $i++) {
  $bet = 2
  $s = (Send "$base/game/blackjack/start" @{ betAmount = $bet } $token).body
  $spent += $bet

  $guard = 0
  while ($s.status -eq 'active' -and $guard -lt 12) {
    $guard++
    if ($s.playerTotal -lt 17) {
      $s = (Send "$base/game/blackjack/hit" @{ gameId = $s.gameId } $token).body
    } else {
      $s = (Send "$base/game/blackjack/stand" @{ gameId = $s.gameId } $token).body
    }
  }

  if ($s.status -eq 'active') { throw "hand $i never finished" }
  if ($statuses.ContainsKey($s.status)) { $statuses[$s.status]++ } else { $statuses[$s.status] = 1 }

  $player = Total $s.playerHand
  $dealer = Total $s.dealerHand
  $wantPayout = 0.0
  if ($player -gt 21) { $wantPayout = 0 }
  elseif ($player -gt $dealer -or $dealer -gt 21) { $wantPayout = $bet * 2 }
  elseif ($player -eq $dealer) { $wantPayout = $bet }
  else { $wantPayout = 0 }

  if ([double]$s.payout -ne $wantPayout) {
    throw "payout mismatch on hand ${i}: you $player vs dealer $dealer -> $($s.payout), expected $wantPayout"
  }
  if ($s.status -eq 'lost' -and [double]$s.payout -ne 0) { throw 'a lost hand paid out' }
  if ($s.status -eq 'push' -and [double]$s.payout -ne $bet) { throw 'a push must refund the stake' }
  if ($s.status -eq 'won' -and [double]$s.payout -ne $bet * 2) { throw 'a win must pay 2x' }

  $won += [double]$s.payout
}
"settled: $(($statuses.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' ')"

Write-Host '== validation =='
$badBet = Send "$base/game/blackjack/start" @{ betAmount = 0 } $token
$unknown = Send "$base/game/blackjack/hit" @{ gameId = [guid]::NewGuid().ToString() } $token
$anon = & curl.exe -s -o NUL -w '%{http_code}' -X POST "$base/game/blackjack/start" -H 'Content-Type: application/json' -d '{\"betAmount\":1}'
"bet0=$($badBet.code)/$($badBet.body.error.code) unknown=$($unknown.code)/$($unknown.body.error.code) anon=$anon"

Write-Host '== ledger =='
$bal = Get-Json "$base/wallet/balance" $token
$expected = [math]::Round(200 - $spent + $won, 2)
"expected=$expected reported=$($bal.balance) staked=$spent returned=$won"
if ([math]::Abs([double]$bal.balance - $expected) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'

