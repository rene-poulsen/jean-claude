# Reads the week's existing events from the configured Outlook calendar (macOS Calendar on a Mac). Read-only.
param(
    [string]$WeekStart,
    [Parameter(Mandatory)][string]$OutFile
)
. "$PSScriptRoot/common.ps1"

$cfg = Get-Config
$monday = Get-WeekStart $WeekStart
$nextMonday = $monday.AddDays(7)

if ($OnMac) {
    $json = Invoke-MacCalendar $cfg 'read' @($monday.ToString('yyyy-MM-dd'), $nextMonday.ToString('yyyy-MM-dd'), $PlanMarker, $cfg.outlook.category)
    $events = @($json | ConvertFrom-Json)
    Write-Json ([pscustomobject]@{ weekStart = $monday.ToString('yyyy-MM-dd'); events = $events }) $OutFile
    "Calendar: $($events.Count) events"
    return
}

$cal = Get-OutlookCalendar $cfg

$items = $cal.folder.Items
$items.Sort('[Start]')
$items.IncludeRecurrences = $true
# Widen the filter by a day and filter precisely below, in case Outlook parses the dates differently.
$filter = "[Start] < '{0}' AND [End] > '{1}'" -f (Format-OutlookDate $nextMonday.AddDays(1)), (Format-OutlookDate $monday.AddDays(-1))

$events = New-Object System.Collections.ArrayList
foreach ($i in $items.Restrict($filter)) {
    $s = [datetime]$i.Start
    $e = [datetime]$i.End
    if ($s -ge $nextMonday -or $e -le $monday) { continue }
    [void]$events.Add([pscustomobject]@{
        subject    = [string]$i.Subject
        start      = $s.ToString('s')
        end        = $e.ToString('s')
        allDay     = [bool]$i.AllDayEvent
        busy       = [int]$i.BusyStatus   # 0 free, 1 tentative, 2 busy, 3 out of office, 4 working elsewhere
        categories = [string]$i.Categories
    })
}

Write-Json ([pscustomobject]@{ weekStart = $monday.ToString('yyyy-MM-dd'); events = @($events) }) $OutFile
"Outlook: $($events.Count) events"
