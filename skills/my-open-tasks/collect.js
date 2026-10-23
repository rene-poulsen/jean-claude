#!/usr/bin/env node
// Usage: node collect.js [--since <YYYY-MM-DD | YYYY-MM-DDTHH:MM | 3h | 2d>] [--again] [--dry]
//        node collect.js --set-roots <folder> [<folder> ...]
// Reads the Claude Code transcripts in ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects) and prints,
// per repo, every main session (no subagents) with activity in the window, so the skill can list open
// questions, things to test and task states.
//   scope: sessions whose folder is under one of the folders saved in config.txt (see config.js);
//          without any, it prints NO_CONFIG and exits 2
//   window start: --since, else --again (the previous window again), else the last run, else 24h ago
//   --dry / --again: don't move the "last run" marker in state.json
// Output:
//   WINDOW <from ISO> -> <to ISO> (<source>)
//   === <repo path> | branch=<b> | uncommitted=<n files>|clean|no-git
//   --- session <session id> "<title>" | <first HH:MM>-<last HH:MM> | msgs=<n> | ended=<who> [| flags]
//   TASK: <first prompt of the session, if it started before the window>
//   [HH:MM] USER: ... / CLAUDE: ... / DID: <commits, pushes, PRs, files edited>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { projects: root, readRoots, setRoots, inRoots } = require('./config');

const statePath = path.join(__dirname, 'state.json');
const SELF = /\bmy-open-tasks\b/;

const args = process.argv.slice(2);
if (args[0] === '--set-roots') {
  if (args.length < 2) { console.error('Usage: collect.js --set-roots <folder> [<folder> ...]'); process.exit(1); }
  setRoots(args.slice(1));
  process.exit(0);
}
const roots = readRoots();
if (!roots.length) { console.log('NO_CONFIG'); process.exit(2); }
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const again = args.includes('--again');
const dry = args.includes('--dry') || again;
const inScope = p => inRoots(roots, p);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}

const now = Date.now();
let from, source;
const s = opt('--since');
if (s) {
  const m = /^(\d+)([hd])$/.exec(s);
  from = m ? now - m[1] * (m[2] === 'h' ? 3600e3 : 86400e3) : new Date(s.length === 10 ? s + 'T00:00:00' : s).getTime();
  source = '--since ' + s;
} else if (again && state.previousRun) { from = Date.parse(state.previousRun); source = 'previous window again'; }
else if (state.lastRun) { from = Date.parse(state.lastRun); source = 'since last run'; }
else { from = now - 86400e3; source = 'first run, last 24h'; }
if (isNaN(from)) { console.error('bad --since ' + s); process.exit(1); }

// --- helpers ----------------------------------------------------------------
const hhmm = t => {
  const d = new Date(t), today = new Date(now).toDateString() === d.toDateString();
  const p = n => String(n).padStart(2, '0');
  return (today ? '' : 'SunMonTueWedThuFriSat'.substr(d.getDay() * 3, 3) + ' ' + d.getDate() + ' ' +
    'JanFebMarAprMayJunJulAugSepOctNovDec'.substr(d.getMonth() * 3, 3) + ' ') +
    p(d.getHours()) + ':' + p(d.getMinutes());
};
const clip = (t, n) => { t = t.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); return t.length > n ? t.slice(0, n) + ' […]' : t; };
const textOf = c => typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '');
// Real things the user typed: drop tool results, hook/system noise and local shell output
function humanText(msg) {
  if (Array.isArray(msg.content) && msg.content.some(b => b.type === 'tool_result')) return null;
  let t = textOf(msg.content);
  if (!t) return null;
  if (/^\s*<(bash-stdout|local-command-stdout|local-command-caveat|system-reminder|task-notification)/.test(t)) return null;
  if (/^Base directory for this skill:/.test(t)) return null; // a skill's expanded body, the /command line above says enough
  const cmd = /<command-name>([^<]*)<\/command-name>[\s\S]*?(?:<command-args>([^<]*)<\/command-args>)?/.exec(t);
  if (cmd) {
    if (/^\/(clear|exit|usage|model|mcp|config|status|cost|help|resume|compact)$/.test(cmd[1].trim())) return null;
    return (cmd[1].trim() + ' ' + (cmd[2] || '')).trim();
  }
  t = t.replace(/<bash-input>([\s\S]*?)<\/bash-input>/, '! $1');
  return t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim() || null;
}
const repoCache = new Map();
function repoOf(cwd) {
  if (repoCache.has(cwd)) return repoCache.get(cwd);
  let d = cwd, r = null;
  while (d && !r) {
    try { if (fs.existsSync(path.join(d, '.git'))) r = d; } catch {}
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  repoCache.set(cwd, r);
  return r;
}

// --- read transcripts -------------------------------------------------------
const sessions = [];
for (const proj of fs.readdirSync(root, { withFileTypes: true })) {
  if (!proj.isDirectory()) continue;
  const dir = path.join(root, proj.name);
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const file = path.join(dir, f);
    if (fs.statSync(file).mtimeMs < from) continue;
    const ses = { id: f.slice(0, -6), title: '', cwd: '', branch: '', entries: [], firstPrompt: null, startedBefore: false };
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'ai-title' || o.type === 'custom-title') { ses.title = o.customTitle || o.aiTitle || ses.title; continue; }
      if ((o.type !== 'user' && o.type !== 'assistant') || o.isSidechain || !o.message) continue;
      const t = Date.parse(o.timestamp);
      if (o.cwd) ses.cwd = o.cwd;
      if (o.gitBranch && o.gitBranch !== 'HEAD') ses.branch = o.gitBranch;
      if (o.type === 'user') {
        const h = humanText(o.message);
        if (!h) continue;
        if (!ses.firstPrompt) { ses.firstPrompt = h; ses.startedBefore = t < from; }
        ses.entries.push({ t, who: 'USER', text: h });
      } else {
        for (const b of Array.isArray(o.message.content) ? o.message.content : []) {
          if (b.type === 'text' && b.text.trim()) ses.entries.push({ t, who: 'CLAUDE', text: b.text });
          else if (b.type === 'tool_use') ses.entries.push({ t, who: 'TOOL', name: b.name, input: b.input || {} });
        }
      }
    }
    // Leave out this very run of the skill (and anything after it in that session)
    const selfAt = ses.entries.findIndex(e => e.who === 'USER' && SELF.test(e.text) && e.t > now - 30 * 60e3);
    if (selfAt >= 0) ses.entries = ses.entries.slice(0, selfAt);
    ses.entries = ses.entries.filter(e => e.t >= from);
    if (!ses.entries.some(e => e.who !== 'TOOL') || !inScope(ses.cwd)) continue;
    sessions.push(ses);
  }
}

// --- summarize per session --------------------------------------------------
function did(entries) {
  const out = [], edited = new Set();
  for (const e of entries) {
    if (e.who !== 'TOOL') continue;
    const i = e.input;
    if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(e.name) && (i.file_path || i.notebook_path)) edited.add(path.basename(i.file_path || i.notebook_path));
    const cmd = i.command || '';
    if (/\bgit\b[^\n]*\bcommit\b/.test(cmd)) {
      // -m "$(cat <<'EOF'\n…", -F - <<'EOF'\n…, PowerShell -m @'\n…, or a plain quoted -m
      const m = /(?:-m\s+"\$\(cat |-F\s*-\s*)<<'?EOF'?\r?\n([^\n]+)|-m\s+(?:@['"]\r?\n([^\n]+)|"([^"]+)"|'([^']+)')/.exec(cmd);
      out.push('commit "' + clip((m && (m[1] || m[2] || m[3] || m[4])) || '?', 100).split('\n')[0] + '"');
    }
    if (/\bgit\b[^\n]*\bpush\b/.test(cmd)) out.push('push');
    if (/\bgh pr (create|merge)\b/.test(cmd)) out.push('gh pr ' + /\bgh pr (create|merge)\b/.exec(cmd)[1]);
    if (/\b(deploy|vercel)\b/i.test(cmd)) out.push('deploy cmd');
  }
  if (edited.size) out.push(`edited ${edited.size} file(s): ${[...edited].slice(0, 8).join(', ')}${edited.size > 8 ? ', …' : ''}`);
  return [...new Set(out)];
}

const byRepo = new Map();
for (const ses of sessions) {
  const dir = repoOf(ses.cwd) || ses.cwd || '(unknown folder)';
  const key = process.platform === 'win32' ? dir.toLowerCase() : dir; // D:\gotcha and D:\Gotcha are the same folder on Windows
  if (!byRepo.has(key)) byRepo.set(key, { dir, list: [] });
  byRepo.get(key).list.push(ses);
}

console.log(`WINDOW ${new Date(from).toISOString()} -> ${new Date(now).toISOString()} (${source}) | roots=${roots.join(',')}`);
if (!sessions.length) console.log('NO SESSIONS');
const first = g => Math.min(...g.list.map(s => s.entries[0].t));
for (const { dir: repo, list } of [...byRepo.values()].sort((a, b) => first(a) - first(b))) {
  let git = 'no-git';
  if (repoOf(repo)) {
    try {
      const st = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8', timeout: 10e3 });
      const n = st.split('\n').filter(Boolean).length;
      git = n ? `uncommitted=${n} files` : 'clean';
      const br = execFileSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8', timeout: 10e3 }).trim();
      if (br) git = `branch=${br} | ` + git;
    } catch { git = 'git status failed'; }
  }
  console.log(`\n=== ${repo} | ${git}`);
  for (const ses of list.sort((a, b) => a.entries[0].t - b.entries[0].t)) {
    const talk = ses.entries.filter(e => e.who !== 'TOOL');
    const last = ses.entries[ses.entries.length - 1];
    const lastTalk = talk[talk.length - 1];
    const flags = [];
    if (last.who === 'TOOL' && ['AskUserQuestion', 'ExitPlanMode'].includes(last.name)) flags.push('waiting on ' + last.name);
    if (lastTalk.who === 'USER' && /\[Request interrupted/.test(lastTalk.text)) flags.push('interrupted by the user');
    else if (lastTalk.who === 'USER') flags.push('ended on the user\'s message (Claude may not have finished)');
    if (ses.branch) flags.push('session branch=' + ses.branch);
    console.log(`\n--- session ${ses.id} "${ses.title || '(untitled)'}" | ${hhmm(ses.entries[0].t)}-${hhmm(last.t)} | msgs=${talk.length} | ended=${lastTalk.who}${flags.length ? ' | ' + flags.join(' | ') : ''}`);
    if (ses.startedBefore) console.log('TASK: ' + clip(ses.firstPrompt, 400));
    const d = did(ses.entries);
    if (d.length) console.log('DID: ' + d.join('; '));
    // Keep the start of the window and the tail; the tail (esp. Claude's last answer) holds the open ends
    const keepHead = 3, keepTail = 10;
    const shown = talk.length > keepHead + keepTail ? [...talk.slice(0, keepHead), null, ...talk.slice(-keepTail)] : talk;
    shown.forEach((e, i) => {
      if (!e) return console.log(`[… ${talk.length - keepHead - keepTail} messages skipped …]`);
      const isLast = i >= shown.length - 2;
      console.log(`[${hhmm(e.t)}] ${e.who}: ${clip(e.text, e.who === 'USER' ? 700 : isLast ? 3000 : 600)}`);
    });
  }
}

// Items still open from earlier runs (kept per repo by items.js), so the new run can carry or close them
console.log('\nOPEN ITEMS FROM EARLIER RUNS');
let carried = 0;
for (const d of fs.readdirSync(root)) {
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(root, d, 'open-tasks.json'), 'utf8')); } catch (e) { continue; }
  if (!inScope(s.repo)) continue;
  for (const it of s.items) {
    if (it.status !== 'open') continue;
    carried++;
    console.log(`${it.no}. #${it.id} | ${s.repo} | [${it.kind}] ${it.task} :: ${it.text}${it.session ? ' | session=' + it.session : ''} | since ${it.created.slice(0, 16).replace('T', ' ')}`);
  }
}
if (!carried) console.log('(none)');

if (!dry) fs.writeFileSync(statePath, JSON.stringify(Object.assign(state, { lastRun: new Date(now).toISOString(), previousRun: new Date(from).toISOString() }), null, 2));
console.log(`\nSTATE ${dry ? 'not updated (dry/again)' : 'last run set to ' + new Date(now).toISOString()}`);
