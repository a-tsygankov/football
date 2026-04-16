[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = 'C:\Workspaces\football'
$metaDir = Join-Path $repoRoot '.claude'
$webPidFile = Join-Path $metaDir 'web.dev.pid'
$workerPidFile = Join-Path $metaDir 'worker.dev.pid'
$webPort = 5173
$workerPort = 8787
$hostname = [System.Net.Dns]::GetHostName()
$runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Stop-ProcessTreeIfRunning {
  param(
    [int]$ProcessId,
    [string]$Label
  )

  try {
    $null = Get-Process -Id $ProcessId -ErrorAction Stop
  } catch {
    return
  }

  Write-Step "Stopping $Label process tree (PID $ProcessId)"
  & taskkill.exe /PID $ProcessId /T /F | Out-Null
}

function Stop-FromPidFile {
  param(
    [string]$PidFile,
    [string]$Label
  )

  if (-not (Test-Path $PidFile)) {
    return
  }

  $rawPid = (Get-Content -Path $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ([string]::IsNullOrWhiteSpace($rawPid)) {
    Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
    return
  }

  $pidValue = 0
  if ([int]::TryParse($rawPid, [ref]$pidValue)) {
    Stop-ProcessTreeIfRunning -ProcessId $pidValue -Label $Label
  }

  Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
}

function Stop-ListenersOnPort {
  param([int]$Port)

  $connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($connections.Count -eq 0) {
    return
  }

  foreach ($processId in ($connections | Select-Object -ExpandProperty OwningProcess -Unique)) {
    Stop-ProcessTreeIfRunning -ProcessId $processId -Label "listener on port $Port"
  }
}

function Start-DevServer {
  param(
    [string]$Label,
    [string]$ScriptName,
    [string]$PidFile
  )

  $logPath = Join-Path $metaDir "$Label.dev.$runStamp.log"
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Set-Content -Path $logPath -Value "[$stamp] starting $Label`r`n"

  $command = @"
Set-Location '$repoRoot'
& pnpm $ScriptName *>> '$logPath'
"@

  $process = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -PassThru

  Set-Content -Path $PidFile -Value $process.Id
  Write-Step "Started $Label (PID $($process.Id))"
  return [pscustomobject]@{
    ProcessId = $process.Id
    LogPath = $logPath
  }
}

function Wait-HttpReady {
  param(
    [string]$Label,
    [string]$Url,
    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      return $response
    } catch {
      Start-Sleep -Milliseconds 750
    }
  } while ((Get-Date) -lt $deadline)

  throw "$Label did not become ready at $Url within $TimeoutSeconds seconds."
}

function Get-LanIps {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.InterfaceAlias -notmatch 'Loopback'
    } |
    Sort-Object InterfaceMetric, SkipAsSource |
    Select-Object -ExpandProperty IPAddress -Unique

  return @($ips)
}

function Test-Port {
  param(
    [string]$ComputerName,
    [int]$Port
  )

  return Test-NetConnection -ComputerName $ComputerName -Port $Port -WarningAction SilentlyContinue
}

function Show-LinkSet {
  param(
    [string]$Title,
    [string]$HostName
  )

  Write-Host ""
  Write-Host $Title -ForegroundColor Green
  Write-Host "  Web:            http://${HostName}:$webPort"
  Write-Host "  Worker health:  http://${HostName}:$workerPort/api/health"
  Write-Host "  Worker version: http://${HostName}:$workerPort/api/version"
}

New-Item -ItemType Directory -Force -Path $metaDir | Out-Null

Write-Step 'Stopping previous dev servers from pid files'
Stop-FromPidFile -PidFile $webPidFile -Label 'web'
Stop-FromPidFile -PidFile $workerPidFile -Label 'worker'

Write-Step 'Stopping any remaining listeners on dev ports'
Stop-ListenersOnPort -Port $webPort
Stop-ListenersOnPort -Port $workerPort

Write-Step 'Starting worker'
$workerRun = Start-DevServer -Label 'worker' -ScriptName 'dev:worker' -PidFile $workerPidFile

Write-Step 'Starting web'
$webRun = Start-DevServer -Label 'web' -ScriptName 'dev:web' -PidFile $webPidFile

Write-Step 'Waiting for worker health endpoint'
$workerHealth = Wait-HttpReady -Label 'worker' -Url "http://localhost:$workerPort/api/health"

Write-Step 'Waiting for web root'
$webRoot = Wait-HttpReady -Label 'web' -Url "http://localhost:$webPort/"

$lanIps = Get-LanIps
$hostnameWeb = Test-Port -ComputerName $hostname -Port $webPort
$hostnameWorker = Test-Port -ComputerName $hostname -Port $workerPort
$ipChecks = foreach ($ip in $lanIps) {
  [pscustomobject]@{
    IP = $ip
    WebTcp = (Test-Port -ComputerName $ip -Port $webPort).TcpTestSucceeded
    WorkerTcp = (Test-Port -ComputerName $ip -Port $workerPort).TcpTestSucceeded
  }
}

$firewallProfiles = Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction

Write-Host ""
Write-Host 'Ready' -ForegroundColor Green
Write-Host "  Web localhost status:    $($webRoot.StatusCode)"
Write-Host "  Worker localhost status: $($workerHealth.StatusCode)"
Write-Host "  Worker localhost body:   $($workerHealth.Content)"
Write-Host "  Logs:"
Write-Host "    Web:    $($webRun.LogPath)"
Write-Host "    Worker: $($workerRun.LogPath)"

Show-LinkSet -Title 'Localhost Links' -HostName 'localhost'
Show-LinkSet -Title 'Hostname Links' -HostName $hostname

foreach ($ip in $lanIps) {
  Show-LinkSet -Title "IP Links ($ip)" -HostName $ip
}

Write-Host ""
Write-Host 'Reachability Checks' -ForegroundColor Green
Write-Host "  Hostname web TCP:    $($hostnameWeb.TcpTestSucceeded)"
Write-Host "  Hostname worker TCP: $($hostnameWorker.TcpTestSucceeded)"
foreach ($check in $ipChecks) {
  Write-Host "  $($check.IP) web TCP: $($check.WebTcp); worker TCP: $($check.WorkerTcp)"
}

Write-Host ""
Write-Host 'Firewall Profiles' -ForegroundColor Green
$firewallProfiles | Format-Table -AutoSize | Out-String | Write-Host
Write-Host 'Note: TCP checks from this machine confirm the servers are bound and reachable locally on hostname/LAN IP. They do not fully prove access from another device if network isolation is in place.'
