#!/usr/bin/env node
// Usage: node tokens.js <since YYYY-MM-DD> < commits.tsv
// stdin: one commit per line: repo \t hash \t unix-time \t "Day DD Mon HH:MM" \t claude-trailer(0|1) \t subject
// Prints the collect.sh format with a token column appended and token totals per repo and overall:
//   === <repo> (<count>)[ out=<n> in=<n> cached=<n> usd=<x.xx>]
//   <Day DD Mon HH:MM>|<subject>|<tokens>
// <tokens> is one of
//   out=<n> in=<n> cached=<n> usd=<x.xx> session=<id8>
//                                             a Claude Code session made the commit; usage in that
//                                             session (incl. subagents) since its previous commit,
//                                             usd = cost at API list prices
//   shared-with=<repo> session=<id8>          same commit command as a commit in <repo>, tokens counted there
//   claude-no-transcript                      Claude Co-Authored-By trailer, but no matching transcript
//   -                                         no sign of Claude Code
// Last line: TOTAL commits=<n> with-claude=<n>[ out=<n> in=<n> cached=<n> usd=<x.xx>],
// then "UNPRICED <model,...>" if a transcript used a model missing from PRICES (counted as $0).
const fs = require('fs');
const path = require('path');
const os = require('os');

const since = new Date((process.argv[2] || '1970-01-01') + 'T00:00:00').getTime();
const scanFrom = since - 3 * 86400e3; // sessions may start before the period
const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');

// "D:\Gotcha\x" and "/d/Gotcha/x" -> "d:/gotcha/x"
const norm = p => p.replace(/\\+/g, '/').replace(/(^|[\s"'=])\/([a-z])\//gi, '$1$2:/').toLowerCase();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- pricing ----------------------------------------------------------------
// API list prices in USD per million tokens: [input, output, cache read]. Cache writes are
// 1.25x input (5-minute TTL) or 2x input (1-hour TTL); fast mode is 2x everything; web search
// is $10 per 1000 searches. Prefixes match longest first, so "claude-opus-5-5" wins over "claude-opus-5".
const PRICES = {
  'claude-fable-5-1': [10, 50, 0.25], 'claude-mythos-5-1': [10, 50, 0.25],
  'claude-fable-5': [10, 50, 1], 'claude-mythos-5': [10, 50, 1],
  'claude-opus-5-5': [4, 20, 0.20], 'claude-opus-5': [5, 25, 0.50],
  'claude-opus-4-8': [5, 25, 0.50], 'claude-opus-4-7': [5, 25, 0.50],
  'claude-opus-4-6': [5, 25, 0.50], 'claude-opus-4-5': [5, 25, 0.50],
  'claude-sonnet-5-5': [2, 10, 0.20], 'claude-sonnet-5': [2, 10, 0.20],
  'claude-sonnet-4-6': [3, 15, 0.30], 'claude-sonnet-4-5': [3, 15, 0.30],
  'claude-haiku-5-5': [0.10, 0.50, 0.01], 'claude-haiku-4-5': [1, 5, 0.10],
};
const PREFIXES = Object.keys(PRICES).sort((a, b) => b.length - a.length);
const unpriced = new Set();
function cost(model, u) {
  const key = PREFIXES.find(p => (model || '').startsWith(p));
  if (!key) { if (model && !model.startsWith('<')) unpriced.add(model); return 0; }
  let [pin, pout, pcr] = PRICES[key];
  const cc = u.cache_creation || {};
  const w1h = cc.ephemeral_1h_input_tokens || 0;
  const w5m = cc.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens || 0) - w1h);
  // Haiku 5.5 costs 5x for prompts over 100K tokens
  const prompt = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  if (key === 'claude-haiku-5-5' && prompt > 100e3) { pin *= 5; pout *= 5; pcr *= 5; }
  const usd = ((u.input_tokens || 0) * pin + w5m * pin * 1.25 + w1h * pin * 2 +
               (u.cache_read_input_tokens || 0) * pcr + (u.output_tokens || 0) * pout) / 1e6;
  const searches = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  return usd * (u.speed === 'fast' ? 2 : 1) + searches * 0.01;
}

// --- read transcripts -------------------------------------------------------
const sessions = new Map(); // id -> { usage: [{t, in, cc, cr, out}], commits: [{t, cmd, where}] }
function session(id) {
  if (!sessions.has(id)) sessions.set(id, { usage: [], commits: [], seen: new Set() });
  return sessions.get(id);
}
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl') && fs.statSync(p).mtimeMs >= scanFrom) out.push(p);
  }
  return out;
}
for (const file of walk(root, [])) {
  // <project>/<session>.jsonl or <project>/<session>/subagents/agent-x.jsonl
  const rel = path.relative(root, file).split(path.sep);
  const sid = rel.length > 2 ? rel[1] : path.basename(file, '.jsonl');
  const s = session(sid);
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"assistant"')) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'assistant' || !j.message) continue;
    const t = Date.parse(j.timestamp);
    if (!t) continue;
    const m = j.message, u = m.usage;
    if (u && m.id && !s.seen.has(m.id)) {
      s.seen.add(m.id);
      s.usage.push({ t, in: u.input_tokens || 0, cc: u.cache_creation_input_tokens || 0,
                     cr: u.cache_read_input_tokens || 0, out: u.output_tokens || 0, usd: cost(m.model, u) });
    }
    for (const c of Array.isArray(m.content) ? m.content : []) {
      const cmd = c.type === 'tool_use' && c.input && c.input.command;
      if (typeof cmd === 'string' && /git\b[^\n]*\bcommit\b/.test(cmd))
        s.commits.push({ sid, t, cmd, where: norm(j.cwd || '') + '\n' + norm(cmd) });
    }
  }
}

// --- match git commits to transcript commit calls ---------------------------
const rows = fs.readFileSync(0, 'utf8').split('\n').filter(Boolean).map(l => {
  const [repo, hash, at, date, trailer, ...subj] = l.split('\t');
  return { repo, hash, t: +at * 1000, date, claude: trailer === '1', subject: subj.join('\t') };
});
const candidates = [...sessions.values()].flatMap(s => s.commits);
const used = new Map(); // candidate -> repos it was matched for
for (const r of rows) {
  // GitHub squash merges append " (#123)" to the subject the commit call used
  const subject = r.subject.replace(/ \(#\d+\)$/, '');
  if (!subject) continue;
  // the subject must be a whole line or a quoted message in the commit command
  const re = new RegExp(`(^|["'\\n])${esc(subject)}(["'\\n]|$)`);
  const repo = norm(r.repo);
  // prefer calls made in (or cd'ing into) this repo, then the closest in time
  const score = c => Math.abs(c.t - r.t) + (c.where.includes(repo) ? 0 : 48 * 3600e3);
  const hit = candidates
    .filter(c => !(used.get(c) || []).includes(r.repo) && Math.abs(c.t - r.t) < 24 * 3600e3 && re.test(c.cmd))
    .sort((a, b) => score(a) - score(b))[0];
  if (!hit) continue;
  // one command can commit in several repos; only the first gets the tokens
  if (used.has(hit)) r.shared = used.get(hit)[0];
  used.set(hit, [...(used.get(hit) || []), r.repo]);
  r.match = hit;
}

const sum = list => list.reduce((a, r) => r.tot ? { in: a.in + r.tot.in, cr: a.cr + r.tot.cr, out: a.out + r.tot.out,
                                                      usd: a.usd + r.tot.usd } : a, { in: 0, cr: 0, out: 0, usd: 0 });
const fmt = t => t.out || t.in || t.cr ? ` out=${t.out} in=${t.in} cached=${t.cr} usd=${t.usd.toFixed(2)}` : '';

// tokens = session usage between the previous matched commit call in that session and this one
const bySession = new Map();
for (const r of rows) if (r.match && !r.shared) {
  if (!bySession.has(r.match.sid)) bySession.set(r.match.sid, []);
  bySession.get(r.match.sid).push(r);
}
for (const [sid, list] of bySession) {
  list.sort((a, b) => a.match.t - b.match.t);
  let from = -Infinity;
  for (const r of list) {
    const to = r.match.t;
    const tot = { in: 0, cr: 0, out: 0, usd: 0 };
    for (const u of sessions.get(sid).usage)
      if (u.t > from && u.t <= to) { tot.in += u.in + u.cc; tot.cr += u.cr; tot.out += u.out; tot.usd += u.usd; }
    r.tot = tot;
    r.tokens = `${fmt(tot).trim()} session=${sid.slice(0, 8)}`;
    from = to;
  }
}
for (const r of rows) if (r.shared)
  r.tokens = `shared-with=${path.basename(r.shared)} session=${r.match.sid.slice(0, 8)}`;

// --- print ------------------------------------------------------------------
const repos = new Map();
for (const r of rows) {
  if (!repos.has(r.repo)) repos.set(r.repo, []);
  repos.get(r.repo).push(r);
}
for (const [repo, list] of repos) {
  console.log(`=== ${repo} (${list.length})${fmt(sum(list))}`);
  for (const r of list)
    console.log(`${r.date}|${r.subject}|${r.tokens || (r.claude ? 'claude-no-transcript' : '-')}`);
}
console.log(`TOTAL commits=${rows.length} with-claude=${rows.filter(r => r.match || r.claude).length}${fmt(sum(rows))}`);
if (unpriced.size) console.log(`UNPRICED ${[...unpriced].join(',')}`);
