$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

# PowerShell rewrites quotes in native args, so JSON bodies go through a file.
function Send-Json([string]$url, $body, [string]$token) {
  $path = Join-Path $env:TEMP ('slots_' + [guid]::NewGuid().ToString('N') + '.json')
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
$creds = @{ phone = $phone; password = 'SlotsGrid123!' }

Write-Host '== register / login / deposit =='
Send-Json "$base/auth/register" $creds | Out-Null
$login = Send-Json "$base/auth/login" $creds
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send-Json "$base/wallet/deposit" @{ amount = 200 } $token | Out-Null

Write-Host '== config =='
$cfg = Get-Json "$base/game/slots/config" $token
"cells=$($cfg.cells) paylines=$($cfg.lines.Count) lineMultiplier=$($cfg.paytable.lineMultiplier) outcomes=$($cfg.outcomes)"
if ($cfg.cells -ne 9) { throw 'expected 9 cells' }
if ($cfg.paytable.lineMultiplier -ne 8.4) { throw 'expected 8.4x per line' }

Write-Host '== spins (max 60, stops on the first win) =='
$expected = 200.0
$spins = 0
$wins = 0
for ($i = 1; $i -le 60; $i++) {
  $r = Send-Json "$base/game/slots/play" @{ betAmount = 1 } $token
  $spins = $i

  if ($r.grid.Count -ne 9) { throw "expected 9 symbols, got $($r.grid.Count)" }

  # Recompute the paylines from the grid itself (rows of 3).
  $wantLines = @()
  for ($row = 0; $row -lt 3; $row++) {
    $a = [string]$r.grid[$row * 3]
    $b = [string]$r.grid[$row * 3 + 1]
    $c = [string]$r.grid[$row * 3 + 2]
    if ($a -eq $b -and $b -eq $c) { $wantLines += $row }
  }

  $gotLines = @($r.winningLines | ForEach-Object { [int]$_ })
  if (($wantLines -join ',') -ne ($gotLines -join ',')) {
    throw "line mismatch on spin ${i}: got [$($gotLines -join ',')] want [$($wantLines -join ',')]"
  }

  $wantMult = [math]::Round($wantLines.Count * 8.4, 2)
  if ([double]$r.multiplier -ne $wantMult) { throw "multiplier mismatch on spin ${i}: got $($r.multiplier) want $wantMult" }
  if ([double]$r.payout -ne [math]::Round(1 * $wantMult, 2)) { throw "payout mismatch on spin ${i}: got $($r.payout)" }
  if ($r.won -ne ($wantMult -gt 0)) { throw "won flag mismatch on spin ${i}" }

  $expected = [math]::Round($expected - 1 + [double]$r.payout, 2)
  if ([math]::Abs([double]$r.balanceAfter - $expected) -gt 0.001) { throw "balance drift on spin ${i}" }

  if ($wantLines.Count -gt 0) {
    $wins++
    Write-Host "  win on spin ${i} : lines [$($wantLines -join ',')] => $($r.multiplier)x -> +$($r.payout)"
    Write-Host "  grid: $($r.grid[0])$($r.grid[1])$($r.grid[2]) / $($r.grid[3])$($r.grid[4])$($r.grid[5]) / $($r.grid[6])$($r.grid[7])$($r.grid[8])"
    break
  }
}
"spins=$spins wins=$wins"

Write-Host '== balance =='
$bal = Get-Json "$base/wallet/balance" $token
"expected=$expected reported=$($bal.balance)"
if ([math]::Abs([double]$bal.balance - $expected) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host '== validation =='
Send-Json "$base/game/slots/play" @{ betAmount = 0 } $token | ConvertTo-Json -Compress
Send-Json "$base/game/slots/play" '{}' $token | ConvertTo-Json -Compress
& curl.exe -s -o NUL -w "unauthenticated_status=%{http_code}`n" -X POST "$base/game/slots/play" -H 'Content-Type: application/json' -d '{\"betAmount\":1}'

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'
