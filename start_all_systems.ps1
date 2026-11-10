# Launch All 10 Autonomous Trading Systems
$logDir = "D:\crypto_system_logs"
if (!(Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$systems = @(
  @{ Port = 3001; Dir = "c:\Users\Rajesh\Downloads\crypto-live-market-&-auto-sell"; Name = "System 1 (Main Autonomous)" },
  @{ Port = 3002; Dir = "D:\crypto-live-market-&-auto-sell-backup\crypto-live-market-&-auto-sell"; Name = "System 2 (Backup Mirror)" },
  @{ Port = 3003; Dir = "D:\crypto-live-market-&-auto-sell-v3"; Name = "System 3 (Delta Options Specialist)" },
  @{ Port = 3004; Dir = "D:\crypto-live-market-&-auto-sell-v4"; Name = "System 4 (Brad Goh SMC Engine)" },
  @{ Port = 3005; Dir = "D:\crypto-live-market-&-auto-sell-v5"; Name = "System 5 (HBA Services Course)" },
  @{ Port = 3006; Dir = "D:\crypto-live-market-&-auto-sell-v6"; Name = "System 6 (Mr How Breakout & MACD)" },
  @{ Port = 3007; Dir = "D:\crypto-live-market-&-auto-sell-v7"; Name = "System 7 (Pushkar Raj Thakur 13-Lesson)" },
  @{ Port = 3008; Dir = "D:\crypto-live-market-&-auto-sell-v8"; Name = "System 8 (Charuka Wyckoff & VSA)" },
  @{ Port = 3009; Dir = "D:\crypto-live-market-&-auto-sell-v9"; Name = "System 9 (Marwadi Trader Delta Options)" },
  @{ Port = 3010; Dir = "D:\crypto-live-market-&-auto-sell-v10"; Name = "System 10 (Stock Burner Trap Engine)" },
  @{ Port = 3012; Dir = "D:\crypto-live-market-&-auto-sell-v12"; Name = "System 12 (IITian Trader Crypto)" },
  @{ Port = 3013; Dir = "D:\crypto-live-market-&-auto-sell-v13"; Name = "System 13 (Neeraj Joshi Crypto)" },
  @{ Port = 3014; Dir = "D:\crypto-live-market-&-auto-sell-v14"; Name = "System 14 (VirtualBacon 7-Year Crypto)" },
  @{ Port = 3015; Dir = "D:\crypto-live-market-&-auto-sell-v15"; Name = "System 15 (Thomas Kralow Institutional)" },
  @{ Port = 3016; Dir = "D:\crypto-live-market-&-auto-sell-v16"; Name = "System 16 (MoneyZG Crypto Masterclass)" },
  @{ Port = 3017; Dir = "D:\crypto-live-market-&-auto-sell-v17"; Name = "System 17 (Fabio Valentini Scalper)" }
)

Write-Host "=========================================================="
Write-Host "🚀 STARTING ALL 16 AUTONOMOUS TRADING SYSTEMS"
Write-Host "=========================================================="

foreach ($sys in $systems) {
  $port = $sys.Port
  $dir = $sys.Dir
  $name = $sys.Name

  # Check if already running on port
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    Write-Host "[$port] $name is ALREADY RUNNING (PID: $($conn.OwningProcess))"
    continue
  }

  if (!(Test-Path $dir)) {
    Write-Warning "[$port] Directory not found: $dir"
    continue
  }

  $outLog = Join-Path $logDir "system_$port.log"
  $errLog = Join-Path $logDir "system_${port}_err.log"

  $proc = Start-Process -FilePath "node" `
    -ArgumentList "./node_modules/tsx/dist/cli.mjs", "server.ts" `
    -WorkingDirectory $dir `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden `
    -PassThru

  Write-Host "[$port] Launched $name (PID: $($proc.Id)) -> Log: $outLog"
  Start-Sleep -Milliseconds 600
}

Write-Host "`nWaiting 5 seconds for servers to bind ports..."
Start-Sleep -Seconds 5

Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ge 3001 -and $_.LocalPort -le 3020 } | Select-Object LocalPort, OwningProcess | Sort-Object LocalPort | Format-Table -AutoSize
