# Fetches WorkBook + Outlook data and prints the proposed plan. Writes nothing to Outlook.
# -SkipFetch re-plans from the already fetched data (e.g. after editing overrides.json or config.json).
param([string]$WeekStart, [switch]$SkipFetch)
. "$PSScriptRoot/common.ps1"

$monday = Get-WeekStart $WeekStart
$dir = Get-WorkDir $monday
$ws = $monday.ToString('yyyy-MM-dd')

if (-not $SkipFetch) {
    & "$PSScriptRoot/fetch-workbook.ps1" -WeekStart $ws -OutFile (Join-Path $dir 'bookings.json')
    & "$PSScriptRoot/read-outlook.ps1" -WeekStart $ws -OutFile (Join-Path $dir 'events.json')
}
& "$PSScriptRoot/plan.ps1" -WorkDir $dir
"`nWorkDir: $dir"
