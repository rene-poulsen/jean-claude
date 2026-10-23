// Shared by collect.js and items.js: where the transcripts are, and which folders are in scope.
// The folders are saved in config.txt next to this script, one "root=<folder>" line each.
const fs = require('fs');
const path = require('path');
const os = require('os');

const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const configPath = path.join(__dirname, 'config.txt');

// "D:\Projects", "/d/Projects" (Git Bash) and "d:/projects/" all become "d:/projects"
const norm = p => {
  p = p.replace(/\\+/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') p = p.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:').toLowerCase();
  return p;
};

function readRoots() {
  let lines = [];
  try { lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/); } catch (e) {}
  return lines.filter(l => l.startsWith('root=')).map(l => norm(l.slice(5).trim())).filter(Boolean);
}

function setRoots(folders) {
  folders = folders.map(norm);
  for (const f of folders) if (!fs.existsSync(f)) console.error('Warning: ' + f + ' does not exist');
  fs.writeFileSync(configPath, folders.map(f => 'root=' + f + '\n').join(''));
  console.log('Saved to ' + configPath + ':\n' + fs.readFileSync(configPath, 'utf8').trim());
}

const inRoots = (roots, p) => { const c = norm(p || ''); return roots.some(r => c === r || c.startsWith(r + '/')); };

module.exports = { projects, norm, readRoots, setRoots, inRoots };
