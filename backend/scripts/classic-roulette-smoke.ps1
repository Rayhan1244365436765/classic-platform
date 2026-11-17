$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

# PowerShell rewrites quotes in native args, so JSON bodies go through a file.
function Send-Json([string]$url, $body, [string]$token) {
  $path = Join-Path $env:TEMP ('cr_' + [guid]::NewGuid().ToString('N') + '.json')
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

# European layout, re-derived here so the server cannot disagree with the test.
$script:reds = @(1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36)

function Colour-Of([int]$pocket) {
  if ($pocket -eq 0) { return 'green' }
  if ($script:reds -contains $pocket) { return 'red' }
  return 'black'
}

function Expected-Win([string]$type, $value, [int]$pocket, [string]$colour) {
  switch ($type) {
    'number' { return ([int]$value -eq $pocket) }
    'red' { return ($colour -eq 'red') }
    'black' { return ($colour -eq 'black') }
    'even' { return ($pocket -ne 0 -and $pocket % 2 -eq 0) }
    'odd' { return ($pocket -ne 0 -and $pocket % 2 -eq 1) }
    'low' { return ($pocket -ge 1 -and $pocket -le 18) }
    'high' { return ($pocket -ge 19 -and $pocket -le 36) }
  }
  throw "unknown bet type '$type'"
}

$phone = '9' + (Get-Random -Minimum 100000000 -Maximum 999999999)
$creds = @{ phone = $phone; password = 'Roulette1!' }

Write-Host '== register / login / deposit =='
Send-Json "$base/auth/register" $creds | Out-Null
$login = Send-Json "$base/auth/login" $creds
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send-Json "$base/wallet/deposit" @{ amount = 300 } $token | Out-Null

Write-Host '== config =='
$cfg = Get-Json "$base/game/classic_roulette/config" $token
"pockets=$($cfg.pockets) reds=$($cfg.redNumbers.Count) wheel=$($cfg.wheelOrder.Count)"
"payouts: number=$($cfg.payouts.number) red=$($cfg.payouts.red) black=$($cfg.payouts.black) even=$($cfg.payouts.even) odd=$($cfg.payouts.odd) low=$($cfg.payouts.low) high=$($cfg.payouts.high)"
"rtp: number=$($cfg.rtp.number) outside=$($cfg.rtp.red) houseEdge=$($cfg.houseEdge)"

if ([int]$cfg.pockets -ne 37) { throw "expected 37 pockets, got $($cfg.pockets)" }
if ([int]$cfg.payouts.number -ne 36) { throw 'a straight number must pay 36x' }
foreach ($box in @('red', 'black', 'even', 'odd', 'low', 'high')) {
  if ([int]$cfg.payouts.$box -ne 2) { throw "even-money box $box must pay 2x" }
}

# The red squares must be exactly the canonical 18.
$cfgReds = @($cfg.redNumbers | ForEach-Object { [int]$_ })
if ($cfgReds.Count -ne 18) { throw "expected 18 red numbers, got $($cfgReds.Count)" }
foreach ($n in $script:reds) {
  if ($cfgReds -notcontains $n) { throw "config is missing red $n" }
}
if ($cfgReds -contains 0) { throw 'zero can never be red' }

# The wheel must be a permutation of 0..36 (a real wheel, not a copy of the grid).
$wheel = @($cfg.wheelOrder | ForEach-Object { [int]$_ })
if ($wheel.Count -ne 37) { throw "wheel has $($wheel.Count) pockets" }
if (($wheel | Sort-Object -Unique).Count -ne 37) { throw 'wheel repeats a pocket' }
if ($wheel[0] -ne 0) { throw 'the European wheel starts at 0' }

# Every bet is priced at 36/37 — the whole point of single-zero roulette.
$expectedRtp = 36 / 37
foreach ($box in @('number', 'red', 'black', 'even', 'odd', 'low', 'high')) {
  if ([math]::Abs([double]$cfg.rtp.$box - $expectedRtp) -gt 1e-9) {
    throw "rtp for $box is $($cfg.rtp.$box), want $expectedRtp"
  }
}
if ([math]::Abs([double]$cfg.houseEdge - (1 / 37)) -gt 1e-9) { throw 'house edge must be 1/37' }

Write-Host '== 37 straight-number spins at $1 (one per pocket) =='
$balance = 300.0
$totalPaid = 0.0
$numberWins = 0
$outsideWins = 0
$seen = @{}
$sampleShown = 0

for ($n = 0; $n -lt 37; $n++) {
  $r = Send-Json "$base/game/classic_roulette/play" @{ betAmount = 1; betType = 'number'; betValue = $n } $token

  $pocket = [int]$r.pocket
  if ($pocket -lt 0 -or $pocket -gt 36) { throw "spin ${n}: pocket $pocket out of range" }
  if ([int]$r.betValue -ne $n) { throw "spin ${n}: betValue $($r.betValue) != $n" }
  if ($r.betType -ne 'number') { throw "spin ${n}: betType echoed wrong" }

  $colour = Colour-Of $pocket
  if ($r.pocketColor -ne $colour) {
    throw "spin ${n}: colour $($r.pocketColor) for pocket $pocket, want $colour"
  }

  # The client rotates the wheel to this index, so it must address the pocket.
  $idx = [int]$r.wheelIndex
  if ($idx -lt 0 -or $idx -gt 36) { throw "spin ${n}: wheelIndex $idx out of range" }
  if ([int]$wheel[$idx] -ne $pocket) {
    throw "spin ${n}: wheelIndex $idx holds pocket $($wheel[$idx]), not $pocket"
  }

  $wantWon = ($pocket -eq $n)
  $wantMult = if ($wantWon) { 36 } else { 0 }
  $wantPayout = [math]::Round(1 * $wantMult, 2)

  if ([bool]$r.won -ne $wantWon) { throw "spin ${n}: won=$($r.won) but pocket $pocket vs bet $n" }
  if ([double]$r.multiplier -ne $wantMult) { throw "spin ${n}: multiplier $($r.multiplier) != $wantMult" }
  if ([math]::Abs([double]$r.payout - $wantPayout) -gt 0.001) {
    throw "spin ${n}: payout $($r.payout) != $wantPayout"
  }
  if (-not $seen.ContainsKey($pocket)) { $seen[$pocket] = 0 }
  $seen[$pocket] = $seen[$pocket] + 1

  if ($wantWon) {
    $numberWins++
    if ($sampleShown -lt 4) {
      "spin {0,2} | backed {1,2} | pocket {2,2} ({3}) | WON {4}x paid `${5}" -f $n, $n, $pocket, $colour, $r.multiplier, $r.payout
      $sampleShown++
    }
  }

  $balance = [math]::Round($balance - 1 + [double]$r.payout, 2)
  if ([math]::Abs([double]$r.balanceAfter - $balance) -gt 0.001) {
    throw "spin ${n}: balance drift (got $($r.balanceAfter) want $balance)"
  }
  $totalPaid += [double]$r.payout
}

"straight-number hits: $numberWins of 37 (expected ~1)"
"distinct pockets seen: $($seen.Count) of 37"

Write-Host '== 180 outside spins at $1 (30 per box) =='
$boxes = @('red', 'black', 'even', 'odd', 'low', 'high')

for ($k = 0; $k -lt 180; $k++) {
  $box = $boxes[$k % 6]
  $r = Send-Json "$base/game/classic_roulette/play" @{ betAmount = 1; betType = $box } $token

  $pocket = [int]$r.pocket
  $colour = Colour-Of $pocket
  if ($r.pocketColor -ne $colour) { throw "outside ${k}: colour mismatch for pocket $pocket" }
  if ([int]$wheel[[int]$r.wheelIndex] -ne $pocket) {
    throw "outside ${k}: wheelIndex $($r.wheelIndex) does not hold pocket $pocket"
  }
  if ($r.betType -ne $box) { throw "outside ${k}: betType $($r.betType) != $box" }
  if ($null -ne $r.betValue) { throw "outside ${k}: an outside bet must echo betValue=null" }

  $wantWon = Expected-Win $box $null $pocket $colour
  $wantMult = if ($wantWon) { 2 } else { 0 }
  $wantPayout = [math]::Round(1 * $wantMult, 2)

  if ([bool]$r.won -ne $wantWon) {
    throw "outside ${k}: won=$($r.won) but $box on pocket $pocket ($colour)"
  }
  if ([double]$r.multiplier -ne $wantMult) { throw "outside ${k}: multiplier $($r.multiplier) != $wantMult" }
  if ([math]::Abs([double]$r.payout - $wantPayout) -gt 0.001) {
    throw "outside ${k}: payout $($r.payout) != $wantPayout"
  }
  # Zero loses every outside bet except nothing at all — no la partage here.
  if ($pocket -eq 0 -and [double]$r.payout -ne 0) { throw "outside ${k}: zero paid an outside bet" }

  if ($wantWon) { $outsideWins++ }

  $balance = [math]::Round($balance - 1 + [double]$r.payout, 2)
  if ([math]::Abs([double]$r.balanceAfter - $balance) -gt 0.001) {
    throw "outside ${k}: balance drift (got $($r.balanceAfter) want $balance)"
  }
  $totalPaid += [double]$r.payout
}

$staked = 217.0
$observedRtp = [math]::Round(($totalPaid / $staked) * 100, 2)
"outside wins: $outsideWins of 180 (expected ~87.6)"
"staked=$staked paid=$totalPaid observed_rtp=$observedRtp% (long-run 97.30%)"

Write-Host '== balance =='
$bal = Get-Json "$base/wallet/balance" $token
"expected=$balance reported=$($bal.balance)"
if ([math]::Abs([double]$bal.balance - $balance) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host '== validation =='
Send-Json "$base/game/classic_roulette/play" @{ betAmount = 1; betType = 'colour' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/classic_roulette/play" @{ betAmount = 1; betType = 'number' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/classic_roulette/play" @{ betAmount = 1; betType = 'number'; betValue = 37 } $token | ConvertTo-Json -Compress
Send-Json "$base/game/classic_roulette/play" @{ betAmount = 1; betType = 'number'; betValue = 1.5 } $token | ConvertTo-Json -Compress
Send-Json "$base/game/classic_roulette/play" @{ betAmount = 0; betType = 'red' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/classic_roulette/play" @{ betAmount = 5000; betType = 'red' } $token | ConvertTo-Json -Compress
& curl.exe -s -o NUL -w "unauthenticated_status=%{http_code}`n" -X POST "$base/game/classic_roulette/play" -H 'Content-Type: application/json' -d '{\"betAmount\":1,\"betType\":\"red\"}'

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'
