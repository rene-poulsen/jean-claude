# Helper for terminal-title.js (Windows). A hook's own console is a hidden one, so a title escape
# written there never reaches the visible window. Instead we attach to the console of the claude.exe
# process that runs the hook and call SetConsoleTitle there.
#   -Find -StartPid <pid>              print the pid of the claude.exe above <pid> (or nothing)
#   -TargetPid <pid> -Title <text>     attach to that process's console and set the title
param([switch]$Find, [int]$StartPid, [int]$TargetPid, [string]$Title)

if ($Find) {
  $procs = @{}
  Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name |
    ForEach-Object { $procs[[int]$_.ProcessId] = $_ }
  $belowTerminal = $null; $p = $StartPid
  for ($i = 0; $i -lt 15 -and $procs.ContainsKey($p); $i++) {
    $x = $procs[$p]
    if ($x.Name -ieq 'claude.exe') { [Console]::Out.Write($p); exit 0 }
    $parent = $procs[[int]$x.ParentProcessId]
    if ($parent -and $parent.Name -ieq 'WindowsTerminal.exe') { $belowTerminal = $p }
    $p = [int]$x.ParentProcessId
  }
  if ($belowTerminal) { [Console]::Out.Write($belowTerminal) }
  exit 0
}

if (-not $TargetPid) { exit 0 }
Add-Type -Namespace TitleHook -Name K -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool SetConsoleTitle(string t);
'@
[void][TitleHook.K]::FreeConsole()
if ([TitleHook.K]::AttachConsole([uint32]$TargetPid)) { [void][TitleHook.K]::SetConsoleTitle($Title) }
