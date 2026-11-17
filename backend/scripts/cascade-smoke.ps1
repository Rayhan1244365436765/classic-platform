$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

function Send-Json([string]$url, $body, [string]$token) {
  $path = Join-Path $env:TEMP ('cs_' + [guid]::NewGuid().ToString('N') + '.json')
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
$creds = @{ phone = $phone; password = 'CascadeTest1!' }

Write-Host '== register / login / deposit =='
Send-Json "$base/auth/register" $creds | Out-Null
$login = Send-Json "$base/auth/login" $creds
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send-Json "$base/wallet/deposit" @{ amount = 300 } $token | Out-Null

Write-Host '== config =='
$cfg = Get-Json "$base/game/cascade/config" $token
"grid=$($cfg.cols)x$($cfg.rows) cells=$($cfg.cells) minCluster=$($cfg.minCluster) maxCascades=$($cfg.maxCascades)"
"multipliers: $($cfg.multipliers -join ' ')"
"symbols: $(($cfg.symbols | ForEach-Object { $_.glyph }) -join ' ')"
"rtp=$($cfg.rtp) over $($cfg.rtpRounds) rounds"

if ($cfg.cols -ne 5 -or $cfg.rows -ne 4 -or $cfg.cells -ne 20) { throw 'unexpected grid' }
if ($cfg.maxCascades -ne 5 -or $cfg.minCluster -ne 3) { throw 'unexpected cascade rules' }
if (($cfg.multipliers -join ',') -ne '1,2,4,8,16') { throw "unexpected multipliers: $($cfg.multipliers -join ',')" }
if ($cfg.symbols.Count -ne 7) { throw "expected 7 symbols, got $($cfg.symbols.Count)" }
if ([double]$cfg.rtp -ne 0.9572) { throw "config RTP $($cfg.rtp) is not the measured 0.9572" }

$symbolIds = @($cfg.symbols | ForEach-Object { $_.id })
$multipliers = @($cfg.multipliers)

Write-Host '== 300 spins at $1 =='
$balance = 300.0
$totalPaid = 0.0
$sumWinMultiples = 0.0
$spinsWithWin = 0
$maxCascadesSeen = 0
$deepestMultiplier = 0
$clusters = 0

for ($i = 0; $i -lt 300; $i++) {
  $r = Send-Json "$base/game/cascade/play" @{ betAmount = 1 } $token

  $cells = @($r.grid)
  if ($cells.Count -ne 20) { throw "spin ${i}: opening grid has $($cells.Count) cells" }
  foreach ($cell in $cells) {
    if ($symbolIds -notcontains $cell) { throw "spin ${i}: unknown symbol '$cell'" }
  }
  if (@($r.finalGrid).Count -ne 20) { throw "spin ${i}: final grid is not 20 cells" }

  $steps = @($r.steps)
  if ($steps.Count -gt 5) { throw "spin ${i}: $($steps.Count) steps > 5" }

  $recomputed = 0.0
  for ($s = 0; $s -lt $steps.Count; $s++) {
    $step = $steps[$s]

    if ([int]$step.step -ne ($s + 1)) { throw "spin ${i} step ${s}: step number $($step.step)" }
    if ([int]$step.multiplier -ne [int]$multipliers[$s]) {
      throw "spin ${i} step ${s}: multiplier $($step.multiplier) != $($multipliers[$s])"
    }

    $stepGrid = @($step.grid)
    if ($stepGrid.Count -ne 20) { throw "spin ${i} step ${s}: grid is not 20 cells" }

    $stepWin = 0.0
    foreach ($cluster in @($step.clusters)) {
      $cellsOfCluster = @($cluster.cells)
      if ($cellsOfCluster.Count -lt 3) {
        throw "spin ${i} step ${s}: cluster of $($cellsOfCluster.Count) is below 3"
      }
      foreach ($cell in $cellsOfCluster) {
        if ([int]$cell -lt 0 -or [int]$cell -gt 19) {
          throw "spin ${i} step ${s}: cell $cell out of range"
        }
        if ($stepGrid[[int]$cell] -ne $cluster.symbol) {
          throw "spin ${i} step ${s}: cell $cell holds $($stepGrid[[int]$cell]) but the cluster says $($cluster.symbol)"
        }
      }

      $sizeIndex = [math]::Min($cellsOfCluster.Count, 8) - 3
      $expectedPay = [double]$cfg.pays.($cluster.symbol)[$sizeIndex]
      if ([math]::Abs([double]$cluster.pay - $expectedPay) -gt 0.0001) {
        throw "spin ${i} step ${s}: pay $($cluster.pay) != $expectedPay for $($cluster.symbol) x$($cellsOfCluster.Count)"
      }
      $expectedWin = [math]::Round($expectedPay * [double]$step.multiplier, 4)
      if ([math]::Abs([double]$cluster.win - $expectedWin) -gt 0.0001) {
        throw "spin ${i} step ${s}: cluster win $($cluster.win) != $expectedWin"
      }

      $stepWin += [double]$cluster.win
      $clusters += 1
    }

    if ([math]::Abs([double]$step.win - $stepWin) -gt 0.001) {
      throw "spin ${i} step ${s}: step win $($step.win) != $stepWin"
    }

    foreach ($cell in @($step.removed)) {
      $covered = $false
      foreach ($cluster in @($step.clusters)) {
        if (@($cluster.cells) -contains $cell) { $covered = $true; break }
      }
      if (-not $covered) { throw "spin ${i} step ${s}: cell $cell cleared without a cluster" }
    }

    $recomputed += [double]$step.win
  }

  if ([math]::Abs([double]$r.totalWin - $recomputed) -gt 0.001) {
    throw "spin ${i}: totalWin $($r.totalWin) != $recomputed"
  }
  if ([int]$r.cascadeCount -ne $steps.Count) { throw "spin ${i}: cascadeCount mismatch" }

  $wantPayout = [math]::Round(1 * [double]$r.totalWin, 2)
  if ([math]::Abs([double]$r.payout - $wantPayout) -gt 0.001) {
    throw "spin ${i}: payout $($r.payout) != $wantPayout"
  }

  $balance = [math]::Round($balance - 1 + [double]$r.payout, 2)
  if ([math]::Abs([double]$r.balanceAfter - $balance) -gt 0.001) {
    throw "spin ${i}: balance drift (got $($r.balanceAfter) want $balance)"
  }

  $totalPaid += [double]$r.payout
  $sumWinMultiples += [double]$r.totalWin
  if ([double]$r.totalWin -gt 0) { $spinsWithWin += 1 }
  if ($steps.Count -gt $maxCascadesSeen) { $maxCascadesSeen = $steps.Count }
  if ($steps.Count -gt 0 -and [int]$steps[$steps.Count - 1].multiplier -gt $deepestMultiplier) {
    $deepestMultiplier = [int]$steps[$steps.Count - 1].multiplier
  }

  if ($i -lt 4) {
    "spin {0,3} | steps {1} | win {2}x | paid {3} | grid [{4}]" -f `
      $i, $steps.Count, $r.totalWin, $r.payout, ($cells -join ' ')
  }
}

"300 spins: hit rate $([math]::Round(100 * $spinsWithWin / 300, 2))% · avg win $([math]::Round($sumWinMultiples / 300, 4))x bet"
"deepest cascade $maxCascadesSeen · highest multiplier ${deepestMultiplier}x · clusters paid $clusters"

Write-Host '== balance =='
$bal = Get-Json "$base/wallet/balance" $token
"expected=$balance reported=$($bal.balance) total_paid=$totalPaid"
if ([math]::Abs([double]$bal.balance - $balance) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host '== validation =='
Send-Json "$base/game/cascade/play" @{ betAmount = 0 } $token | ConvertTo-Json -Compress
Send-Json "$base/game/cascade/play" @{ betAmount = 'spin' } $token | ConvertTo-Json -Compress
Send-Json "$base/game/cascade/play" @{ betAmount = 5000 } $token | ConvertTo-Json -Compress
& curl.exe -s -o NUL -w "unauthenticated_status=%{http_code}`n" -X POST "$base/game/cascade/play" -H 'Content-Type: application/json' -d '{\"betAmount\":1}'

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'
