# Shared helpers for the plan-my-week scripts. Dot-source this file.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$SkillRoot = Split-Path $PSScriptRoot -Parent

# Windows uses classic Outlook (COM). On a Mac (PowerShell 7) the calendar is read and written through
# macOS Calendar (EventKit) by mac-calendar.swift, so it works with any account added to Calendar.
$OnMac = [bool]$IsMacOS

# First line of every planned event's body. On a Mac it marks the skill's own events (no Outlook categories there).
$PlanMarker = 'Planned from WorkBook (plan-my-week)'

function Read-Json([string]$Path) {
    [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

function Write-Json($Object, [string]$Path) {
    $json = $Object | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding $false))
}

function Get-Config {
    $path = Join-Path $SkillRoot 'config.json'
    if (-not (Test-Path $path)) { throw "NO_CONFIG: $path not found - copy config.example.json to config.json and fill it in." }
    Read-Json $path
}

# Monday of the week to plan. Defaults to next week; any date is snapped back to its Monday.
function Get-WeekStart([string]$WeekStart) {
    if ($WeekStart) {
        $d = [datetime]::ParseExact($WeekStart, 'yyyy-MM-dd', $null)
        while ($d.DayOfWeek -ne [DayOfWeek]::Monday) { $d = $d.AddDays(-1) }
    } else {
        $d = (Get-Date).Date.AddDays(1)
        while ($d.DayOfWeek -ne [DayOfWeek]::Monday) { $d = $d.AddDays(1) }
    }
    $d.Date
}

function Get-WorkDir([datetime]$Monday) {
    $p = Join-Path (Join-Path ([IO.Path]::GetTempPath()) 'plan-my-week') $Monday.ToString('yyyy-MM-dd')
    New-Item -ItemType Directory -Force $p | Out-Null
    $p
}

function ConvertTo-Minutes([string]$HHmm) {
    $p = $HHmm.Split(':')
    [int]$p[0] * 60 + [int]$p[1]
}

function Format-Minutes([int]$Minutes) {
    '{0:00}:{1:00}' -f [Math]::Floor($Minutes / 60), ($Minutes % 60)
}

# Outlook's Restrict() parses dates using the Windows regional settings.
function Format-OutlookDate([datetime]$Date) {
    $Date.ToString('g', [Globalization.CultureInfo]::CurrentCulture)
}

function Get-OutlookCalendar($Cfg) {
    $ol = New-Object -ComObject Outlook.Application
    $store = $null
    foreach ($s in $ol.Session.Stores) { if ($s.DisplayName -eq $Cfg.outlook.store) { $store = $s; break } }
    if (-not $store) {
        foreach ($s in $ol.Session.Stores) { if ($s.DisplayName -like "*$($Cfg.outlook.store)*") { $store = $s; break } }
    }
    if (-not $store) { throw "Outlook store '$($Cfg.outlook.store)' not found. Is classic Outlook running with that account?" }
    @{ session = $ol.Session; folder = $store.GetDefaultFolder(9) }  # 9 = olFolderCalendar
}

# Runs mac-calendar.swift against the calendar from config.json (mac.account / mac.calendar) and returns its output.
function Invoke-MacCalendar($Cfg, [string]$Command, [string[]]$Arguments) {
    if (-not (Get-Command swift -ErrorAction SilentlyContinue)) {
        throw 'NO_SWIFT: swift not found - install the Xcode Command Line Tools with: xcode-select --install'
    }
    $account = if ($Cfg.mac -and $Cfg.mac.account) { $Cfg.mac.account } else { $Cfg.outlook.store }
    $calendar = if ($Cfg.mac -and $Cfg.mac.calendar) { $Cfg.mac.calendar } else { '*' }
    $out = & swift (Join-Path $PSScriptRoot 'mac-calendar.swift') $Command $account $calendar @Arguments
    if ($LASTEXITCODE -ne 0) { throw "mac-calendar.swift $Command failed (see the error above)." }
    $out -join "`n"
}

# The WorkBook API key: a Windows user environment variable, or on a Mac the login keychain.
function Get-WorkbookApiKey {
    $key = $env:WORKBOOK_API_KEY
    if ($OnMac) {
        if (-not $key) { $key = & security find-generic-password -s WORKBOOK_API_KEY -w 2>$null }
    } else {
        $user = [Environment]::GetEnvironmentVariable('WORKBOOK_API_KEY', 'User')
        if ($user) { $key = $user }
    }
    $key
}

function Test-HasCategory([string]$Categories, [string]$Name) {
    $cats = @($Categories -split '[,;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $cats -contains $Name
}
