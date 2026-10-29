param([ValidateSet('Offline','Login','Failed','Complete','Setup')][string]$Reason='Failed',[string]$Account='',[ValidateSet('Ended','Playback','Native','Stale','Unknown')][string]$Cause='Unknown')
$ErrorActionPreference='Stop'
$deviceKey=$env:DAZHONG_BARK_KEY
if(-not $deviceKey){$deviceKey=[Environment]::GetEnvironmentVariable('DAZHONG_BARK_KEY','User')}
if($deviceKey -notmatch '^[A-Za-z0-9_-]+$'){Write-Output 'Bark not configured';exit 2}
$messages=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'alert-messages.json') -Encoding UTF8 -Raw|ConvertFrom-Json
$lines=@();if($Account -match '^(?:[0-9]{4}|[a-f0-9-]{36})$'){$lines+=($messages.AccountLabel+$Account)};$lines+=$messages.$Reason;if($Cause -ne 'Unknown'){$lines+=$messages.Causes.$Cause}
$payload=@{device_key=$deviceKey;title=$messages.Title;body=($lines -join "`n");group=$messages.Group;isArchive='1'}|ConvertTo-Json -Compress
try{$reply=Invoke-RestMethod -Uri 'https://api.day.app/push' -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 15;if($reply.code -eq 200){Write-Output 'Bark API accepted'}else{Write-Output 'Bark API rejected';exit 3}}catch{Write-Output 'Bark delivery unknown';exit 4}
