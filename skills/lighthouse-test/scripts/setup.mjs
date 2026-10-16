// Tool setup for the lighthouse-test skill.
//
// Installs Playwright (+ its headless Chromium) and a pinned Lighthouse version once into a
// per-user cache, so nothing is added to the project's package.json.
//
// Usage: node ~/.claude/skills/lighthouse-test/scripts/setup.mjs   (installs if needed and prints the paths)
//   WEB_TESTS_DIR=<dir>   use another cache folder (default: ~/.cache/claude-web-tests)
// From a script: import { ensure } from './setup.mjs'; const { chromium, lighthouseCli } = ensure();
import { execSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export const TOOLS_DIR = path.resolve(process.env.WEB_TESTS_DIR || path.join(os.homedir(), '.cache', 'claude-web-tests'));
// Pinned so Lighthouse scores can be compared with earlier reports. Update both here and in the reports' "How it was tested".
export const LIGHTHOUSE_VERSION = '12.8.2';
const PLAYWRIGHT_RANGE = '1';

const pkgVersion = name => {
    const file = path.join(TOOLS_DIR, 'node_modules', name, 'package.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).version : null;
};

export function ensure({ quiet = false } = {}) {
    const [major] = process.versions.node.split('.').map(Number);
    if (major < 22) throw new Error(`Node 22+ is required (found ${process.versions.node})`);

    fs.mkdirSync(TOOLS_DIR, { recursive: true });
    const pkgFile = path.join(TOOLS_DIR, 'package.json');
    if (!fs.existsSync(pkgFile)) fs.writeFileSync(pkgFile, JSON.stringify({ name: 'claude-web-tests', private: true }, null, 2));

    if (!pkgVersion('playwright') || pkgVersion('lighthouse') !== LIGHTHOUSE_VERSION) {
        if (!quiet) console.log(`Installing playwright@${PLAYWRIGHT_RANGE} and lighthouse@${LIGHTHOUSE_VERSION} into ${TOOLS_DIR}`);
        execSync(`npm install --no-audit --no-fund --loglevel=error playwright@${PLAYWRIGHT_RANGE} lighthouse@${LIGHTHOUSE_VERSION}`, { cwd: TOOLS_DIR, stdio: 'inherit' });
    }

    const require = createRequire(pkgFile);
    const { chromium } = require('playwright');
    if (!fs.existsSync(chromium.executablePath())) {
        if (!quiet) console.log('Downloading Playwright Chromium');
        execSync(`"${process.execPath}" "${path.join(TOOLS_DIR, 'node_modules', 'playwright', 'cli.js')}" install chromium`, { stdio: 'inherit' });
    }
    return { chromium, lighthouseCli: path.join(TOOLS_DIR, 'node_modules', 'lighthouse', 'cli', 'index.js') };
}

// Run directly (not imported). Compared case-insensitively because Windows drive letters can differ in case
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
    const { chromium, lighthouseCli } = ensure();
    console.log(`Tools dir:  ${TOOLS_DIR}`);
    console.log(`Playwright: ${pkgVersion('playwright')}`);
    console.log(`Chromium:   ${chromium.executablePath()}`);
    console.log(`Lighthouse: ${pkgVersion('lighthouse')} (${lighthouseCli})`);
}
