#!/usr/bin/env node
// Sets the terminal window title to the GitHub repo name (origin remote, else the repo folder name), or
// to the folder name outside a git repo. A Jira key named in a prompt (e.g. RT-436) is remembered for the
// session and appended: "jean-claude - RT-436".
//
// Wire it to SessionStart, CwdChanged, UserPromptSubmit and Stop, and set
// CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 so Claude Code doesn't overwrite the title. See README.md.
//
// Windows: a hook runs in its own hidden console, so a title escape never reaches the visible window.
// set-console-title.ps1 attaches to claude.exe's console and calls SetConsoleTitle instead (~0.4 s), so
// the claude.exe pid and the last title set are cached per session and the call is skipped when nothing
// changed. Elsewhere the escape is written to /dev/tty.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NOT_JIRA = new Set(['UTF', 'SHA', 'ISO', 'RFC', 'CVE', 'ES', 'HTTP', 'TLS', 'SSL', 'MD', 'AES', 'RSA',
  'IPV', 'COVID', 'GPT', 'PR', 'DW', 'NET']);
const STATE_DIR = path.join(__dirname, '.title-state');
const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function run(cmd, args, timeout) {
  try {
    return execFileSync(cmd, args,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout }).trim();
  } catch { return ''; }
}
const git = (cwd, args) => run('git', ['--no-optional-locks', '-C', cwd, ...args], 3000);

function baseTitle(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top) return path.basename(path.resolve(cwd)) || path.resolve(cwd); // drive root stays "D:\"
  const m = git(top, ['remote', 'get-url', 'origin']).match(/[/:]([^/:]+?)(?:\.git)?\/?$/);
  return (m && m[1]) || path.basename(top);
}

// Per-session state: { task, pid, title } in .title-state/<session_id>.json.
function loadState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveState(file, state) {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(state)); } catch {}
}
function pruneOldState() {
  try {
    for (const f of fs.readdirSync(STATE_DIR)) {
      const p = path.join(STATE_DIR, f);
      if (Date.now() - fs.statSync(p).mtimeMs > STATE_MAX_AGE_MS) fs.unlinkSync(p);
    }
  } catch {}
}

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
const cwd = input.new_cwd || input.cwd || process.cwd();
const isStart = input.hook_event_name === 'SessionStart';
const sid = String(input.session_id || '').replace(/[^\w-]/g, '');
const stateFile = sid && path.join(STATE_DIR, sid + '.json');
const state = stateFile ? loadState(stateFile) : {};
if (isStart) {
  pruneOldState();
  delete state.pid;   // a resumed session runs in a new claude.exe
  delete state.title; // always set the title on start
}

// The most recent Jira key named in a prompt wins.
if (typeof input.prompt === 'string') {
  const keys = [...input.prompt.matchAll(/\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g)].filter(m => !NOT_JIRA.has(m[1]));
  if (keys.length) state.task = keys[keys.length - 1][0];
}

const title = (baseTitle(cwd) + (state.task ? ' - ' + state.task : '')).replace(/[\x00-\x1f]/g, '');
if (process.env.TITLE_DEBUG) console.log(title);

if (process.platform === 'win32') {
  const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'set-console-title.ps1')];
  if (!/^\d+$/.test(state.pid || '')) {
    state.pid = run('powershell.exe', [...psArgs, '-Find', '-StartPid', String(process.ppid)], 6000);
  }
  // Synchronous on purpose: a detached child is killed when the hook exits.
  if (/^\d+$/.test(state.pid) && state.title !== title) {
    try {
      execFileSync('powershell.exe', [...psArgs, '-TargetPid', state.pid, '-Title', title],
        { stdio: 'ignore', windowsHide: true, timeout: 6000 });
      state.title = title;
    } catch {}
  }
} else {
  try { const fd = fs.openSync('/dev/tty', 'w'); fs.writeSync(fd, `\x1b]0;${title}\x07`); fs.closeSync(fd); } catch {}
}

if (stateFile) saveState(stateFile, state);
process.exit(0);
