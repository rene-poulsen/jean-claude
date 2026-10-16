# Reads the week's bookings for the configured resource from WorkBook. Read-only.
param(
    [string]$WeekStart,
    [Parameter(Mandatory)][string]$OutFile
)
. "$PSScriptRoot/common.ps1"

$cfg = Get-Config
$monday = Get-WeekStart $WeekStart
$nextMonday = $monday.AddDays(7)

$apiKey = Get-WorkbookApiKey
if (-not $apiKey) { throw 'WORKBOOK_API_KEY is not set. Create a personal API key in WorkBook and store it as described in the skill README.' }

# The only function that talks to WorkBook. Read-only by design: it can only issue GET requests.
function Invoke-WorkbookGet([string]$Path) {
    $uri = $cfg.workbook.baseUrl.TrimEnd('/') + '/api' + $Path
    try {
        $resp = Invoke-WebRequest -Uri $uri -Method Get -UseBasicParsing -TimeoutSec 60 `
            -Headers @{ Authorization = "Bearer $apiKey"; Accept = 'application/json' }
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        if ($status -eq 401) { throw 'WorkBook rejected the API key (401). It has probably expired (max 3 months) - create a new personal API key and store it again.' }
        throw "WorkBook GET $Path failed: $($_.Exception.Message)"
    }
    [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json
}

# The key's owner is the resource whose bookings we read, unless config.json names another one.
$resourceId = $cfg.workbook.resourceId
if (-not $resourceId) {
    $me = Invoke-WorkbookGet '/auth/handshake'
    $resourceId = $me.Id
    if (-not $resourceId) { throw 'WorkBook returned no user id for this API key.' }
}
$usage = Invoke-WorkbookGet "/resource/capacity/usage/resource/$resourceId"

$taskCache = @{}
$lines = New-Object System.Collections.ArrayList
foreach ($u in $usage) {
    $hours = [double]$u.HoursUsed
    if ($hours -le 0) { continue }
    $day = [datetime]::ParseExact(([string]$u.DayDate).Substring(0, 10), 'yyyy-MM-dd', $null)
    if ($day -lt $monday -or $day -ge $nextMonday) { continue }

    $ref = [int]$u.ReferenceId
    if (-not $taskCache.ContainsKey($ref)) {
        $taskResource = Invoke-WorkbookGet "/task/resource/$ref"
        $taskCache[$ref] = Invoke-WorkbookGet "/task/$($taskResource.TaskId)/visualization"
    }
    $t = $taskCache[$ref]
    [void]$lines.Add([pscustomobject]@{
        date         = $day.ToString('yyyy-MM-dd')
        hours        = $hours
        customerId   = $t.CustomerId
        customerName = ([string]$t.CustomerName).Trim()
        jobId        = $t.JobId
        jobName      = ([string]$t.JobName).Trim()
        taskId       = $t.Id
        taskNumber   = $t.TaskNumber
        taskName     = ([string]$t.TaskName).Trim()
    })
}

Write-Json ([pscustomobject]@{
    weekStart = $monday.ToString('yyyy-MM-dd')
    fetchedAt = (Get-Date).ToString('s')
    lines     = @($lines)
}) $OutFile

$total = 0.0; foreach ($l in $lines) { $total += $l.hours }
"WorkBook: $($lines.Count) bookings, $total hours"
