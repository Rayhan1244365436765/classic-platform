$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000/api'

function Send([string]$url, $body, [string]$token) {
  $inFile = Join-Path $env:TEMP ('plk_in_' + [guid]::NewGuid().ToString('N') + '.json')
  $outFile = Join-Path $env:TEMP ('plk_out_' + [guid]::NewGuid().ToString('N') + '.json')
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
$creds = @{ phone = $phone; password = 'PlinkoTest123!' }

Write-Host '== register / login / deposit 200 =='
Send "$base/auth/register" $creds $null | Out-Null
$login = (Send "$base/auth/login" $creds $null).body
if (-not $login.token) { throw 'login failed' }
$token = $login.token
Write-Host "user=$($login.user.id)"
Send "$base/wallet/deposit" @{ amount = 200 } $token | Out-Null

Write-Host '== config =='
$cfg = Get-Json "$base/game/plinko/config" $token
"rows=$($cfg.rows) slots=$($cfg.slots) rtp=$($cfg.rtp) multipliers=$($cfg.multipliers -join ',')"
if ($cfg.slots -ne 9 -or $cfg.rows -ne 8) { throw 'unexpected board' }
if ([math]::Abs([double]$cfg.rtp - 0.97) -gt 0.0001) { throw "RTP is $($cfg.rtp), expected 0.97" }

Write-Host '== 120 drops at $1 =='
$expected = 200.0
$slots = @{}
for ($i = 0; $i -lt 120; $i++) {
  $r = Send "$base/game/plinko/play" @{ betAmount = 1; rows = 8 } $token
  if ($r.code -ne 201) { throw "drop failed: $($r.code) $($r.body.error.code)" }
  $g = $r.body

  if ($g.path.Count -ne 8) { throw "path must have 8 steps, got $($g.path.Count)" }
  $rights = @($g.path | Where-Object { $_ -eq 'R' }).Count
  if ($rights -ne [int]$g.slot) { throw "slot $($g.slot) != rights $rights" }
  if ([double]$g.multiplier -ne [double]$cfg.multipliers[[int]$g.slot]) {
    throw "multiplier mismatch at slot $($g.slot): $($g.multiplier)"
  }
  if ([double]$g.payout -ne [math]::Round(1 * [double]$g.multiplier, 2)) { throw 'payout mismatch' }

  $key = "$($g.slot)"
  if ($slots.ContainsKey($key)) { $slots[$key] = $slots[$key] + 1 } else { $slots[$key] = 1 }

  $expected = [math]::Round($expected - 1 + [double]$g.payout, 2)
  if ([math]::Abs([double]$g.balanceAfter - $expected) -gt 0.001) { throw "balance drift on drop ${i}" }
}

function Slot-Count($map, $key) {
  if ($map.ContainsKey($key)) { return [int]$map[$key] }
  return 0
}

$dist = (0..8 | ForEach-Object { "$_=$(Slot-Count $slots "$_")" }) -join ' '
"slot distribution: $dist"
$edgeHits = (Slot-Count $slots '0') + (Slot-Count $slots '8')
"edge hits (5.49x): $edgeHits · centre hits (0.49x): $(Slot-Count $slots '4')"

Write-Host '== validation =='
$badBet = Send "$base/game/plinko/play" @{ betAmount = 0 } $token
$badRows = Send "$base/game/plinko/play" @{ betAmount = 1; rows = 12 } $token
$anon = & curl.exe -s -o NUL -w '%{http_code}' -X POST "$base/game/plinko/play" -H 'Content-Type: application/json' -d '{\"betAmount\":1}'
"bet0=$($badBet.code)/$($badBet.body.error.code) rows12=$($badRows.code)/$($badRows.body.error.code) anon=$anon"

Write-Host '== ledger =='
$bal = Get-Json "$base/wallet/balance" $token
"expected=$expected reported=$($bal.balance)"
if ([math]::Abs([double]$bal.balance - $expected) -gt 0.001) { throw 'LEDGER MISMATCH' }

Write-Host "USER_ID=$($login.user.id)"
Write-Host 'ALL_CHECKS_PASSED'
