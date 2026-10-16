# Writes plan.json for the week into Outlook. Previously planned events (category from config)
# in that week are removed first (they go to Deleted Items), so re-running replaces instead of duplicating.
# On a Mac it writes to macOS Calendar instead (see mac-calendar.swift).
param([string]$WeekStart)
. "$PSScriptRoot/common.ps1"

$cfg = Get-Config
$monday = Get-WeekStart $WeekStart
$nextMonday = $monday.AddDays(7)
$dir = Get-WorkDir $monday
$planPath = Join-Path $dir 'plan.json'
if (-not (Test-Path $planPath)) { throw "No plan found at $planPath - run plan-week.ps1 first." }
$plan = Read-Json $planPath
if ($plan.weekStart -ne $monday.ToString('yyyy-MM-dd')) { throw "plan.json is for week $($plan.weekStart), not $($monday.ToString('yyyy-MM-dd'))." }

# On a Mac the skill's own events are recognised by $PlanMarker in their notes instead of by category.
if ($OnMac) {
    Invoke-MacCalendar $cfg 'apply' @($planPath, $PlanMarker)
    return
}

$cal = Get-OutlookCalendar $cfg
$category = $cfg.outlook.category
$hasCategory = $false
foreach ($c in $cal.session.Categories) { if ($c.Name -eq $category) { $hasCategory = $true } }
if (-not $hasCategory) { [void]$cal.session.Categories.Add($category) }

$items = $cal.folder.Items
$items.Sort('[Start]')
$filter = "[Start] < '{0}' AND [End] > '{1}'" -f (Format-OutlookDate $nextMonday.AddDays(1)), (Format-OutlookDate $monday.AddDays(-1))
$old = @()
foreach ($i in $items.Restrict($filter)) {
    $s = [datetime]$i.Start
    if ($s -ge $monday -and $s -lt $nextMonday -and -not $i.IsRecurring -and (Test-HasCategory ([string]$i.Categories) $category)) { $old += $i }
}
foreach ($i in $old) { $i.Delete() }

$created = 0
foreach ($e in $plan.events) {
    $date = [datetime]::ParseExact($e.date, 'yyyy-MM-dd', $null)
    $a = $cal.folder.Items.Add(1)   # 1 = olAppointmentItem
    $a.Subject = $e.title
    $a.Start = $date.AddMinutes((ConvertTo-Minutes $e.start))
    $a.End = $date.AddMinutes((ConvertTo-Minutes $e.end))
    $a.Body = $e.body
    $a.Categories = $category
    $a.BusyStatus = 2
    $a.ReminderSet = $false
    $a.Save()
    $created++
}
"Outlook: removed $($old.Count) previously planned events, created $created events."
