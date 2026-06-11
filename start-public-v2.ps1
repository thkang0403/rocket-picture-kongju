$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$logPath = Join-Path $projectRoot "public-v2.log"
$serverPath = Join-Path $projectRoot "server\server.js"

$nodeCandidates = @(
  "$env:ProgramFiles\nodejs\node.exe",
  "${env:ProgramFiles(x86)}\nodejs\node.exe",
  "$env:LocalAppData\Programs\nodejs\node.exe"
)

$nodePath = $nodeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $nodePath) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    $nodePath = $nodeCommand.Source
  }
}

if (-not $nodePath) {
  Add-Content -Path $logPath -Value "Node.js was not found."
  exit 1
}

try {
  $env:PORT = "3001"
  $env:PUBLIC_ROOM_CODE = "PUBLIC"
  Add-Content -Path $logPath -Value "Starting public V2 server on http://localhost:3001/join/PUBLIC"
  $process = Start-Process -WindowStyle Hidden -FilePath $nodePath -ArgumentList @($serverPath) -WorkingDirectory $projectRoot -PassThru
  Add-Content -Path $logPath -Value "Started server process PID=$($process.Id)"
} catch {
  Add-Content -Path $logPath -Value "Failed to start server: $($_.Exception.Message)"
  exit 1
}
