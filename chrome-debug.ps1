param(
    [ValidateSet('start', 'status')]
    [string]$Action = 'start',
    [int]$Port = 9222
)

$ErrorActionPreference = 'Stop'
$profileDir = Join-Path $env:LOCALAPPDATA 'CodexChromeProfiles\gdgbpx-debug'
$endpoint = "http://127.0.0.1:$Port"
$chromeCandidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

function Get-DebugStatus {
    try {
        $version = Invoke-RestMethod -Uri "$endpoint/json/version" -TimeoutSec 2
        $targets = Invoke-RestMethod -Uri "$endpoint/json/list" -TimeoutSec 2
        $pageTargets = @(
            foreach ($target in $targets) {
                if ($target.type -eq 'page') {
                    [pscustomobject]@{ Title = $target.title; Url = $target.url; Id = $target.id }
                }
            }
        )
        return [pscustomobject]@{
            Connected = $true
            Browser = $version.Browser
            Endpoint = $endpoint
            Profile = $profileDir
            Targets = $pageTargets
        }
    } catch {
        return [pscustomobject]@{
            Connected = $false
            Browser = ''
            Endpoint = $endpoint
            Profile = $profileDir
            Targets = @()
        }
    }
}

if ($Action -eq 'status') {
    Get-DebugStatus | ConvertTo-Json -Depth 5
    exit 0
}

$status = Get-DebugStatus
if (-not $status.Connected) {
    if (-not $chrome) {
        throw 'Google Chrome was not found.'
    }
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
    $arguments = @(
        '--remote-debugging-address=127.0.0.1',
        "--remote-debugging-port=$Port",
        "--user-data-dir=$profileDir",
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        'https://gbpx.gd.gov.cn/gdceportal/index.aspx'
    )
    Start-Process -FilePath $chrome -ArgumentList $arguments

    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 500
        $status = Get-DebugStatus
    } while (-not $status.Connected -and (Get-Date) -lt $deadline)
}

if (-not $status.Connected) {
    throw "Chrome started but CDP endpoint $endpoint is unavailable. Close the dedicated Chrome and retry."
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1 LocalAddress, LocalPort, OwningProcess
if ($listener.LocalAddress -notin @('127.0.0.1', '::1')) {
    throw "Unsafe CDP listen address: $($listener.LocalAddress)."
}

$status | ConvertTo-Json -Depth 5
