/**
 * Builds a Chrome Web Store upload zip containing only what the extension
 * needs at runtime — no tests, tooling, or repository metadata.
 *
 * Run: node tools/package.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const INCLUDE = ['manifest.json', 'src', 'icons', 'LICENSE'];
const OUT = path.join(ROOT, 'dist');
const zipName = `canvasmax-${manifest.version}.zip`;
const zipPath = path.join(OUT, zipName);

// Refuse to ship a build that does not pass its own checks.
execFileSync(process.execPath, [path.join(__dirname, 'check.js')], { stdio: 'inherit' });

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(zipPath, { force: true });

execFileSync('zip', ['-r', '-q', '-X', zipPath, ...INCLUDE], { cwd: ROOT });

const size = fs.statSync(zipPath).size;
console.log(`\nPackaged ${path.relative(ROOT, zipPath)} (${(size / 1024).toFixed(1)} KB)`);
console.log('Upload it at https://chrome.google.com/webstore/devconsole');
