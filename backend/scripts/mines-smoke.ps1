$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

function Send([string]$url, $body, [string]$token) {
  $inFile = Join-Path $env:TEMP ('mines_in_' + [guid]::NewGuid().ToString('N') + '.json')
  $outFile = Join-Path $env:TEMP ('mines_out_' + [guid]::NewGuid().ToString('N') + '.json')
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

$phone = '9' + (Get-Random -Minimum 100000000 -Maximum 999999999)
$creds = @{ phone = $phone; password = 'MinesTest123!' }

Write-Host '== register / login / deposit 300 =='
Send "$base/auth/register" $creds $null | Out-Null
$login = (Send "$base/auth/login" $creds $null).body
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send "$base/wallet/deposit" @{ amount = 300 } $token | Out-Null

$spent = 0.0
$won = 0.0

Write-Host '== pay table (3 mines) =='
$table = Get-Json "$base/game/mines/table?mines=3" $token
"multipliers: $($table.multipliers.Count) entries, first five = $(($table.multipliers[0..4] | ForEach-Object { $_.ToString('0.00') }) -join ', ')"
if ($table.multipliers[0] -ne 1.1) { throw "unexpected first multiplier: $($table.multipliers[0])" }

Write-Host '== start: board must stay hidden =='
$start = Send "$base/game/mines/start" @{ betAmount = 10; minesCount = 3 } $token
if ($start.code -ne 201) { throw "start failed: $($start.code) $($start.body.error.code)" }
$game = $start.body
$spent += 10
if ($null -ne $game.grid -or $null -ne $game.gridState -or $null -ne $game.mines) {
  throw 'LEAK: the mine layout was returned at start'
}
if ([double]$game.balanceAfter -ne 290) { throw "stake not debited: $($game.balanceAfter)" }
"gameId=$($game.gameId) mines=$($game.minesCount) multiplier=$($game.multiplier) balance=$($game.balanceAfter)"

Write-Host '== second start while active must be rejected =='
$blocked = Send "$base/game/mines/start" @{ betAmount = 5; minesCount = 3 } $token
"second start -> $($blocked.code) $($blocked.body.error.code)"
if ($blocked.code -ne 409 -or $blocked.body.error.code -ne 'GAME_IN_PROGRESS') { throw 'expected GAME_IN_PROGRESS' }

Write-Host '== the active board can be resumed =='
$resume = Get-Json "$base/game/mines/current" $token
if ($resume.game.gameId -ne $game.gameId) { throw 'resume did not return the active board' }
"resume -> gameId=$($resume.game.gameId) mines=$($resume.game.minesCount) multiplier=$($resume.game.multiplier) gems=$($resume.game.revealedTiles.Count)"

Write-Host '== reveal tiles until a gem opens =='
$state = $null
for ($tile = 0; $tile -lt 6; $tile++) {
  $reveal = Send "$base/game/mines/reveal" @{ gameId = $game.gameId; tileIndex = $tile } $token
  if ($reveal.code -ne 200) { throw "reveal failed: $($reveal.code) $($reveal.body.error.code)" }
  $state = $reveal.body
  "tile $tile -> $($state.status) multiplier=$($state.multiplier) gems=$($state.safeTiles)"

  if ($state.status -eq 'lost') { break }
  if ($state.safeTiles -ge 1) { break }
}
if ($state.status -ne 'active' -or $state.safeTiles -lt 1) { throw 'expected an active game with at least one gem' }
if ([double]$state.multiplier -ne $table.multipliers[$state.safeTiles - 1]) {
  throw "multiplier mismatch: got $($state.multiplier) want $($table.multipliers[$state.safeTiles - 1])"
}

Write-Host '== cash out =='
$cash = Send "$base/game/mines/cashout" @{ gameId = $game.gameId } $token
"$($cash.code) status=$($cash.body.status) multiplier=$($cash.body.multiplier) payout=$($cash.body.payout) mines=$($cash.body.mines.Count)"
if ($cash.body.status -ne 'won') { throw 'expected won' }
if ([double]$cash.body.payout -ne [math]::Round(10 * [double]$cash.body.multiplier, 2)) { throw 'payout mismatch' }
if ($cash.body.mines.Count -ne 3) { throw 'expected the 3 mine positions on settle' }
$won += [double]$cash.body.payout

Write-Host '== settled game must reject further actions =='
$again = Send "$base/game/mines/cashout" @{ gameId = $game.gameId } $token
$late = Send "$base/game/mines/reveal" @{ gameId = $game.gameId; tileIndex = 24 } $token
"cashout again -> $($again.code)/$($again.body.error.code) · reveal -> $($late.code)/$($late.body.error.code)"
if ($again.body.error.code -ne 'GAME_ALREADY_SETTLED' -or $late.body.error.code -ne 'GAME_ALREADY_SETTLED') {
  throw 'expected GAME_ALREADY_SETTLED'
}

Write-Host '== loss path: 24 mines, open tiles until it explodes =='
$lostState = $null
$lostGame = $null
for ($attempt = 0; $attempt -lt 5; $attempt++) {
  $s = Send "$base/game/mines/start" @{ betAmount = 5; minesCount = 24 } $token
  $spent += 5
  $lostGame = $s.body.gameId

  for ($tile = 0; $tile -lt 2; $tile++) {
    $r = (Send "$base/game/mines/reveal" @{ gameId = $lostGame; tileIndex = $tile } $token).body
    if ($r.status -eq 'lost') { $lostState = $r; break }
  }
  if ($lostState) { break }
  # Opened the single safe tile and won — start another board.
  Send "$base/game/mines/cashout" @{ gameId = $lostGame } $token | Out-Null
}
if (-not $lostState) { throw 'could not reach a losing board in 5 attempts' }
"lost: bombIndex=$($lostState.bombIndex) mines=$($lostState.mines.Count) payout=$($lostState.payout) gems=$($lostState.safeTiles)"
if ($lostState.payout -ne 0) { throw 'a lost game must not pay' }
if ($lostState.mines.Count -ne 24) { throw 'expected all 24 mines revealed' }
if ($lostState.revealedTiles.Count -ne $lostState.safeTiles) { throw 'revealedTiles mismatch' }

Write-Host '== validation =='
$badMines = Send "$base/game/mines/start" @{ betAmount = 5; minesCount = 0 } $token
$badBet = Send "$base/game/mines/start" @{ betAmount = 0; minesCount = 3 } $token
$badTile = Send "$base/game/mines/reveal" @{ gameId = [guid]::NewGuid().ToString(); tileIndex = 25 } $token
$unknown = Send "$base/game/mines/cashout" @{ gameId = [guid]::NewGuid().ToString() } $token
$anon = & curl.exe -s -o NUL -w '%{http_code}' -X POST "$base/game/mines/start" -H 'Content-Type: application/json' -d '{\"betAmount\":1,\"minesCount\":3}'
"mines0=$($badMines.code)/$($badMines.body.error.code) bet0=$($badBet.code)/$($badBet.body.error.code) tile25=$($badTile.code)/$($badTile.body.error.code) unknown=$($unknown.code)/$($unknown.body.error.code) anon=$anon"

Write-Host '== ledger =='
$bal = Get-Json "$base/wallet/balance" $token
$expected = [math]::Round(300 - $spent + $won, 2)
"expected=$expected reported=$($bal.balance) spent=$spent won=$won"
if ([math]::Abs([double]$bal.balance - $expected) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'

