#!/usr/bin/env node
// Open items (questions, things to test, task states) kept per repo in the repo's Claude project
// folder: ~/.claude/projects/<repo path with non-alphanumerics as "-">/open-tasks.json
//   { "repo": "D:\\projects\\x", "items": [{ id, kind, task, text, session, created, status, resolvedAt, note }] }
// kind: question | test | state;  status: open | done
//
// Usage:
//   node items.js save <file.json>          upsert items: [{ id?, repo, kind, task, text, session?, status?, note? }]
//                                           (no id = new item; an id updates that item). Then prints the open list.
//   node items.js list                      print the open list (repos under the folders in config.txt)
//   node items.js done <n|#id>... [--note <text>]   mark items done (n = the item's number)
//   node items.js answer <n|#id> <text>     mark a question answered, keeping the answer as its note
//   node items.js reopen <n|#id>...         set items back to open
// Every item gets a permanent number (counter in state.json), so "done 12" always means the same item.
// The open list is printed per repo, questions first. Lines:
//   === <repo>
//   <no>. [<kind>] <task> :: <text> | #<id> | session=<id> | since <date>
//   DONE <repo> :: <task> :: <text>[ :: <note>]   (items closed by this command)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { projects, norm, readRoots, inRoots } = require('./config');

const statePath = path.join(__dirname, 'state.json');
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const fileFor = repo => path.join(projects, repo.replace(/[^a-zA-Z0-9]/g, '-'), 'open-tasks.json');
const KIND_ORDER = { question: 0, test: 1, state: 2 };

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = n => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const now = new Date().toISOString();

// All stores, keyed by file
function loadAll() {
  const stores = new Map();
  for (const d of fs.readdirSync(projects)) {
    const f = path.join(projects, d, 'open-tasks.json');
    if (fs.existsSync(f)) stores.set(f, readJson(f, { items: [] }));
  }
  return stores;
}
const saveStore = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(s, null, 2)); };

function printOpen(stores, roots) {
  const rows = [];
  for (const [f, s] of stores) {
    if (roots && !inRoots(roots, s.repo)) continue;
    for (const it of s.items) if (it.status === 'open') rows.push({ f, s, it });
  }
  rows.sort((a, b) => norm(a.s.repo).localeCompare(norm(b.s.repo)) ||
    KIND_ORDER[a.it.kind] - KIND_ORDER[b.it.kind] || a.it.created.localeCompare(b.it.created));
  let repo = null;
  rows.forEach(r => {
    if (r.s.repo !== repo) { repo = r.s.repo; console.log('=== ' + repo); }
    console.log(`${r.it.no}. [${r.it.kind}] ${r.it.task} :: ${r.it.text} | #${r.it.id}${r.it.session ? ' | session=' + r.it.session : ''} | since ${r.it.created.slice(0, 16).replace('T', ' ')}`);
  });
  if (!rows.length) console.log('NO OPEN ITEMS');
}

// "3" -> item number, "#a1b2c3" -> item id
function resolve(stores, refs) {
  return refs.map(ref => {
    for (const [file, s] of stores) {
      const it = s.items.find(x => ref[0] === '#' ? x.id === ref.slice(1) : String(x.no) === ref);
      if (it) return { file, s, it };
    }
    console.error('unknown item ' + ref); process.exit(1);
  });
}
const done = (r, note) => {
  Object.assign(r.it, { status: 'done', resolvedAt: now }, note ? { note } : {});
  console.log(`DONE ${r.s.repo} :: ${r.it.task} :: ${r.it.text}${r.it.note ? ' :: ' + r.it.note : ''}`);
};

const stores = loadAll();
if (cmd === 'save') {
  const input = readJson(args[0], null);
  if (!input) { console.error('cannot read ' + args[0]); process.exit(1); }
  const touched = new Set();
  for (const x of input.items || input) {
    const file = fileFor(x.repo);
    if (!stores.has(file)) stores.set(file, { repo: x.repo, items: [] });
    const s = stores.get(file);
    let it = x.id && s.items.find(i => i.id === x.id);
    if (!it) {
      const st = readJson(statePath, {});
      st.nextNo = (st.nextNo || 1) + 1;
      fs.writeFileSync(statePath, JSON.stringify(st, null, 2));
      it = { id: crypto.randomBytes(3).toString('hex'), no: st.nextNo - 1, kind: x.kind, task: x.task, text: x.text, session: x.session || null, created: now, status: 'open' };
      s.items.push(it);
    } else {
      for (const k of ['kind', 'task', 'text', 'session']) if (x[k]) it[k] = x[k];
    }
    if (x.status === 'done' && it.status !== 'done') done({ s, it }, x.note);
    else if (x.note) it.note = x.note;
    touched.add(file);
  }
  for (const f of touched) saveStore(f, stores.get(f));
  printOpen(stores);
} else if (cmd === 'list') {
  const roots = readRoots();
  if (!roots.length) { console.log('NO_CONFIG'); process.exit(2); }
  printOpen(stores, roots);
} else if (cmd === 'done' || cmd === 'reopen') {
  const note = flag('--note');
  for (const r of resolve(stores, args)) {
    if (cmd === 'done') done(r, note);
    else { Object.assign(r.it, { status: 'open', resolvedAt: null }); console.log(`REOPENED ${r.s.repo} :: ${r.it.task} :: ${r.it.text}`); }
    saveStore(r.file, r.s);
  }
} else if (cmd === 'answer') {
  const [r] = resolve(stores, [args[0]]);
  done(r, 'answer: ' + args.slice(1).join(' '));
  saveStore(r.file, r.s);
} else {
  console.error('usage: items.js save <file.json> | list | done <n|#id>... [--note <text>] | answer <n|#id> <text> | reopen <n|#id>...');
  process.exit(1);
}
