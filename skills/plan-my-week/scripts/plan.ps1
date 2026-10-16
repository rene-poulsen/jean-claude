# Builds the week plan from bookings.json + events.json (+ optional overrides.json) in -WorkDir.
# Writes plan.json and prints a readable preview. Touches neither WorkBook nor Outlook.
param([Parameter(Mandatory)][string]$WorkDir)
. "$PSScriptRoot/common.ps1"

$cfg = Get-Config
$bookings = Read-Json (Join-Path $WorkDir 'bookings.json')
$calendar = Read-Json (Join-Path $WorkDir 'events.json')
$overrides = $null
$overridesPath = Join-Path $WorkDir 'overrides.json'
if (Test-Path $overridesPath) { $overrides = Read-Json $overridesPath }

$monday = [datetime]::ParseExact($bookings.weekStart, 'yyyy-MM-dd', $null)
$slot = 15
$gapMin = [int]$cfg.planning.gapMinutes
$lunchS = ConvertTo-Minutes $cfg.planning.lunch.start
$lunchE = ConvertTo-Minutes $cfg.planning.lunch.end
$dash = [string][char]0x2013
$dayOffset = @{ Mon = 0; Tue = 1; Wed = 2; Thu = 3; Fri = 4; Sat = 5; Sun = 6 }
$questions = New-Object System.Collections.ArrayList
$notes = New-Object System.Collections.ArrayList

# ---------------------------------------------------------------- days
# Lunch comes on top of the working hours, so a day ends at start + hours + lunch.
$days = @()
foreach ($dc in $cfg.planning.days) {
    $start = ConvertTo-Minutes $dc.start
    $end = $start + [int]([double]$dc.hours * 60)
    if ($start -lt $lunchE -and $end -gt $lunchS) { $end += $lunchE - $lunchS }
    $day = @{
        name = $dc.day; date = $monday.AddDays($dayOffset[$dc.day]); start = $start; end = $end; off = $false
        blocks = (New-Object System.Collections.ArrayList); placed = (New-Object System.Collections.ArrayList)
    }
    [void]$day.blocks.Add(@{ s = $lunchS; e = $lunchE; owner = '__lunch'; kind = 'lunch'; label = 'Lunch' })
    $days += $day
}

function Find-Day([datetime]$Date) {
    foreach ($d in $days) { if ($d.date -eq $Date.Date) { return $d } }
    $null
}

# ---------------------------------------------------------------- bookings -> items
# Booking dates are ignored on purpose: the whole week's hours are pooled per customer.
function Get-CleanJobName([string]$Name) { ($Name -replace '\s*\([^)]*\)', '').Trim() }

$excluded = @()
if ($overrides -and $overrides.excludeCustomers) { $excluded = @($overrides.excludeCustomers) }

$customers = [ordered]@{}
foreach ($l in $bookings.lines) {
    $key = $l.customerName
    if ($excluded -contains $key) { continue }
    if (-not $customers.Contains($key)) {
        $customers[$key] = @{ id = $key; kind = 'customer'; hours = 0.0; jobs = [ordered]@{}; tasks = [ordered]@{}; anchored = $false }
    }
    $c = $customers[$key]
    $c.hours += [double]$l.hours
    $jobName = Get-CleanJobName $l.jobName
    $jobKey = [string]$l.jobId
    if (-not $c.jobs.Contains($jobKey)) { $c.jobs[$jobKey] = $jobName }
    $taskKey = [string]$l.taskId
    if (-not $c.tasks.Contains($taskKey)) { $c.tasks[$taskKey] = @{ label = "$($l.jobId) $jobName - $($l.taskNumber) $($l.taskName)"; hours = 0.0 } }
    $c.tasks[$taskKey].hours += [double]$l.hours
}

if ($overrides -and $overrides.setHours) {
    foreach ($p in $overrides.setHours.PSObject.Properties) {
        if ($customers.Contains($p.Name)) { $customers[$p.Name].hours = [double]$p.Value }
    }
}

function ConvertTo-SlotMinutes([double]$Hours) { [int]([Math]::Round($Hours * 60 / $slot)) * $slot }

foreach ($c in @($customers.Values)) {
    $c.need = ConvertTo-SlotMinutes $c.hours
    $c.remaining = $c.need
    if ($c.need -le 0) { $customers.Remove($c.id) ; continue }
    $jobNames = @($c.jobs.Values | Select-Object -Unique)
    $c.title = "$($c.id) $dash " + ($jobNames -join ' / ')
    $taskLines = @($c.tasks.Values | ForEach-Object { "- $($_.label): $($_.hours) h" })
    $c.body = "$PlanMarker`r`n`r`nBookings this week:`r`n" + ($taskLines -join "`r`n")
}

# ---------------------------------------------------------------- calendar events -> blocks
function Get-IndexOf([string]$Haystack, [string]$Needle) { $Haystack.IndexOf($Needle, [StringComparison]::OrdinalIgnoreCase) }

$askedSubjects = @{}
# A meeting "belongs" to a booked customer when the subject (before ':') matches an alias or the customer name.
function Find-MeetingCustomer([string]$Subject) {
    $prefix = ($Subject -split ':')[0].Trim()
    if (-not $prefix) { return $null }
    if ($cfg.aliases) {
        foreach ($p in $cfg.aliases.PSObject.Properties) {
            if ($p.Name -eq $prefix) { if ($customers.Contains($p.Value)) { return $p.Value } else { return $null } }
        }
    }
    foreach ($k in $customers.Keys) {
        if ($prefix -eq $k) { return $k }
        if ($prefix.Length -ge 4 -and ((Get-IndexOf $k $prefix) -ge 0 -or (Get-IndexOf $prefix $k) -ge 0)) { return $k }
    }
    $word = ($prefix -split '\s+')[0]
    if ($word.Length -ge 4 -and -not $askedSubjects.ContainsKey($Subject)) {
        foreach ($k in $customers.Keys) {
            if ((($k -split '\s+')[0]) -eq $word) {
                $askedSubjects[$Subject] = $true
                [void]$questions.Add([pscustomobject]@{ type = 'possibleMatch'; meeting = $Subject; prefix = $prefix; customer = $k })
                break
            }
        }
    }
    $null
}

foreach ($e in $calendar.events) {
    if (Test-HasCategory $e.categories $cfg.outlook.category) { continue }   # our own events get replaced
    if (@($cfg.outlook.ignoreSubjects) -contains ([string]$e.subject).Trim()) { continue }
    $s = [datetime]$e.start
    $en = [datetime]$e.end
    if ($e.allDay) {
        if ([int]$e.busy -eq 3) {
            for ($x = $s.Date; $x -lt $en.Date; $x = $x.AddDays(1)) {
                $d = Find-Day $x
                if ($d -and -not $d.off) { $d.off = $true; [void]$notes.Add("$($d.name) $($x.ToString('dd.MM')): out of office ('$($e.subject)') - nothing planned") }
            }
        }
        continue
    }
    if ([int]$e.busy -eq 0) { continue }
    $d = Find-Day $s
    if (-not $d) { continue }
    $endMin = if ($en.Date -gt $s.Date) { 24 * 60 } else { $en.TimeOfDay.TotalMinutes }
    $sMin = [int]([Math]::Floor($s.TimeOfDay.TotalMinutes / $slot) * $slot)
    $eMin = [int]([Math]::Ceiling($endMin / $slot) * $slot)
    $owner = $null
    if ([int]$e.busy -ne 3) { $owner = Find-MeetingCustomer $e.subject }
    [void]$d.blocks.Add(@{ s = $sMin; e = $eMin; owner = $owner; kind = 'meeting'; label = $e.subject; meeting = $true })
}

# ---------------------------------------------------------------- placement engine
# 'free', 'own' (a meeting this item may overlap - its time counts towards the item), or 'blocked'.
function Get-SlotState($Day, [int]$T, [string]$ItemId) {
    $state = 'free'
    foreach ($b in $Day.blocks) {
        if ($T -ge $b.s -and $T -lt $b.e) {
            if ($b.meeting -and $b.owner -and $b.owner -eq $ItemId) { $state = 'own' } else { return 'blocked' }
        }
    }
    $state
}

function Test-PlacedEndsAt($Day, [int]$T, [string]$ItemId) {
    foreach ($b in $Day.blocks) { if ($b.kind -eq 'placed' -and $b.e -eq $T -and $b.itemId -ne $ItemId) { return $true } }
    $false
}

# Walks the day from $From and collects up to $Need minutes for the item. Does not change anything.
function Find-Placement($Day, $Item, [int]$Need, [int]$From) {
    $segs = New-Object System.Collections.ArrayList
    $cur = $null; $used = 0; $gapAt = -1
    $t = [Math]::Max($From, $Day.start)
    while ($t -lt $Day.end -and $used -lt $Need) {
        $state = Get-SlotState $Day $t $Item.id
        if ($state -eq 'blocked') {
            if ($cur) { [void]$segs.Add($cur); $cur = $null }
            $t += $slot; continue
        }
        # 15 min between planned events - only while the week has spare time for it.
        if (-not $cur -and $segs.Count -eq 0 -and $gapAt -lt 0 -and $script:gapBudget -ge $gapMin -and (Test-PlacedEndsAt $Day $t $Item.id)) {
            $gapAt = $t; $t += $gapMin; continue
        }
        if (-not $cur) { $cur = @{ s = $t; e = $t } }
        $t += $slot; $cur.e = $t; $used += $slot
    }
    if ($cur) { [void]$segs.Add($cur) }
    @{ segs = $segs; used = $used; gapAt = $gapAt }
}

function Save-Placement($Day, $Item, $Result) {
    if ($Result.used -le 0) { return }
    if ($Result.gapAt -ge 0) {
        [void]$Day.blocks.Add(@{ s = $Result.gapAt; e = $Result.gapAt + $gapMin; owner = '__gap'; kind = 'gap' })
        $script:gapBudget -= $gapMin
    }
    foreach ($sg in $Result.segs) {
        [void]$Day.blocks.Add(@{ s = $sg.s; e = $sg.e; owner = '__placed'; kind = 'placed'; itemId = $Item.id })
        [void]$Day.placed.Add(@{ s = $sg.s; e = $sg.e; item = $Item })
    }
    $Item.remaining -= $Result.used
}

# Spare time in the week = slots not taken by lunch or other people's meetings, minus booked hours.
$capacity = 0
foreach ($d in $days) {
    if ($d.off) { continue }
    for ($t = $d.start; $t -lt $d.end; $t += $slot) {
        $hard = $false
        foreach ($b in $d.blocks) { if ($t -ge $b.s -and $t -lt $b.e -and -not ($b.meeting -and $b.owner)) { $hard = $true; break } }
        if (-not $hard) { $capacity += $slot }
    }
}
$bookedMin = 0
foreach ($c in $customers.Values) { $bookedMin += $c.need }
$script:gapBudget = $capacity - $bookedMin

# 1) Customers with a matching meeting: one block that covers (overlaps) the meeting.
foreach ($c in $customers.Values) {
    $anchor = $null
    foreach ($d in $days) {
        if ($d.off) { continue }
        foreach ($b in ($d.blocks | Where-Object { $_.meeting -and $_.owner -eq $c.id } | Sort-Object { $_.s })) {
            $anchor = @{ day = $d; block = $b }; break
        }
        if ($anchor) { break }
    }
    if (-not $anchor) { continue }
    $c.anchored = $true
    $d = $anchor.day; $b = $anchor.block
    $r = Find-Placement $d $c $c.remaining $d.start
    $covers = $false
    foreach ($sg in $r.segs) { if ($sg.s -le $b.s -and $sg.e -ge $b.e) { $covers = $true } }
    if (-not $covers) { $r = Find-Placement $d $c $c.remaining $b.s }
    Save-Placement $d $c $r

    # Other meetings with the same customer that the block does not cover still count towards its hours.
    foreach ($d2 in $days) {
        foreach ($b2 in @($d2.blocks | Where-Object { $_.meeting -and $_.owner -eq $c.id })) {
            $covered = $false
            foreach ($p in $d2.placed) { if ($p.item.id -eq $c.id -and $p.s -le $b2.s -and $p.e -ge $b2.e) { $covered = $true } }
            if (-not $covered) { $c.remaining = [Math]::Max(0, $c.remaining - ($b2.e - $b2.s)) }
        }
    }
}

# 2) Everything else flows through the week, biggest customer first, keeping each customer's hours together.
$queue = New-Object System.Collections.ArrayList
foreach ($c in $customers.Values) { if ($c.anchored -and $c.remaining -gt 0) { [void]$queue.Add($c) } }
foreach ($c in @($customers.Values | Where-Object { -not $_.anchored -and $_.remaining -gt 0 } | Sort-Object { $_.remaining } -Descending)) { [void]$queue.Add($c) }

foreach ($d in $days) {
    if ($d.off) { continue }
    while ($queue.Count -gt 0) {
        $item = $queue[0]
        $r = Find-Placement $d $item $item.remaining $d.start
        if ($r.used -le 0) { break }
        Save-Placement $d $item $r
        if ($item.remaining -le 0) { $queue.RemoveAt(0) } else { break }
    }
}

foreach ($item in $queue) {
    [void]$questions.Add([pscustomobject]@{ type = 'unplaced'; item = $item.title; hours = $item.remaining / 60 })
}

# ---------------------------------------------------------------- output
$events = New-Object System.Collections.ArrayList
$daySummaries = New-Object System.Collections.ArrayList
$preview = New-Object System.Collections.ArrayList
[void]$preview.Add("Week $($monday.ToString('dd.MM.yyyy')) - $($monday.AddDays(6).ToString('dd.MM.yyyy'))")

foreach ($d in $days) {
    # Merge touching segments of the same item into one event.
    $merged = New-Object System.Collections.ArrayList
    foreach ($p in ($d.placed | Sort-Object { $_.s })) {
        $last = if ($merged.Count) { $merged[$merged.Count - 1] } else { $null }
        if ($last -and $last.item.id -eq $p.item.id -and $last.e -eq $p.s) { $last.e = $p.e }
        else { [void]$merged.Add(@{ s = $p.s; e = $p.e; item = $p.item }) }
    }
    $plannedMin = 0
    foreach ($m in $merged) {
        $plannedMin += $m.e - $m.s
        [void]$events.Add([pscustomobject]@{
            date = $d.date.ToString('yyyy-MM-dd'); day = $d.name
            start = (Format-Minutes $m.s); end = (Format-Minutes $m.e)
            title = $m.item.title; body = $m.item.body; itemId = $m.item.id
        })
    }
    $free = 0
    if (-not $d.off) {
        for ($t = $d.start; $t -lt $d.end; $t += $slot) { if ((Get-SlotState $d $t '') -eq 'free') { $free += $slot } }
    }
    [void]$daySummaries.Add([pscustomobject]@{
        day = $d.name; date = $d.date.ToString('yyyy-MM-dd'); off = $d.off
        window = "$(Format-Minutes $d.start)-$(Format-Minutes $d.end)"; plannedHours = $plannedMin / 60; freeHours = $free / 60
    })

    [void]$preview.Add('')
    if ($d.off) { [void]$preview.Add("$($d.name) $($d.date.ToString('dd.MM'))  OFF / OUT OF OFFICE"); continue }
    [void]$preview.Add("$($d.name) $($d.date.ToString('dd.MM'))  $(Format-Minutes $d.start)-$(Format-Minutes $d.end)  planned $($plannedMin / 60) h, free $($free / 60) h")
    $rows = @()
    foreach ($m in $merged) { $rows += @{ s = $m.s; text = "  $(Format-Minutes $m.s)-$(Format-Minutes $m.e)  $($m.item.title)" } }
    foreach ($b in $d.blocks) {
        if ($b.kind -eq 'meeting') {
            $tag = if ($b.owner) { "(meeting - overlapped by $($b.owner))" } else { '(meeting - busy)' }
            $rows += @{ s = $b.s; text = "  $(Format-Minutes $b.s)-$(Format-Minutes $b.e)  [$($b.label)] $tag" }
        }
    }
    foreach ($row in ($rows | Sort-Object { $_.s })) { [void]$preview.Add($row.text) }
}

$plannedTotal = 0; foreach ($s in $daySummaries) { $plannedTotal += $s.plannedHours }
$freeTotal = 0; foreach ($s in $daySummaries) { $freeTotal += $s.freeHours }
[void]$preview.Add('')
[void]$preview.Add("Booked in WorkBook: $($bookedMin / 60) h. Planned: $plannedTotal h. Free time: $freeTotal h.")
foreach ($n in $notes) { [void]$preview.Add("NOTE: $n") }
foreach ($q in $questions) {
    switch ($q.type) {
        'possibleMatch' { [void]$preview.Add("QUESTION: Does the meeting '$($q.meeting)' belong to the customer '$($q.customer)'?") }
        'unplaced'      { [void]$preview.Add("QUESTION: $($q.hours) h of '$($q.item)' did not fit in the week.") }
    }
}

Write-Json ([pscustomobject]@{
    weekStart = $bookings.weekStart
    events = @($events); days = @($daySummaries)
    bookedHours = $bookedMin / 60; plannedHours = $plannedTotal; freeHours = $freeTotal
    questions = @($questions); notes = @($notes)
}) (Join-Path $WorkDir 'plan.json')

$preview -join "`n"
