/**
 * Static checks that run without a browser.
 *
 * Catches the packaging mistakes that a unit test cannot: a syntax error in a
 * file nothing imports, a CSS variable the theme engine never defines, a
 * manifest pointing at a file that was renamed.
 *
 * Run: node tools/check.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const problems = [];
const notes = [];

const rel = (file) => path.relative(ROOT, file);

function walk(dir, filter) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

// ------------------------------------------------------------- syntax ----

const jsFiles = walk(ROOT, (name) => name.endsWith('.js'));
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    problems.push(`syntax error in ${rel(file)}\n${err.stderr?.toString().trim()}`);
  }
}
notes.push(`syntax-checked ${jsFiles.length} JavaScript files`);

// ----------------------------------------------------------- manifest ----

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const referenced = [
  manifest.background.service_worker,
  manifest.options_ui.page,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
];
for (const file of referenced) {
  if (!fs.existsSync(path.join(ROOT, file))) problems.push(`manifest references missing file: ${file}`);
}
notes.push(`manifest references ${referenced.length} files, all present`);

// -------------------------------------------------------- css variables --

/**
 * Every --cmx-* variable consumed by a stylesheet must be produced by
 * themes.js, or defined with a fallback, or declared locally.
 */
const cssFiles = walk(path.join(ROOT, 'src'), (name) => name.endsWith('.css'));
const themesSource = fs.readFileSync(path.join(ROOT, 'src/lib/themes.js'), 'utf8');
const produced = new Set([...themesSource.matchAll(/'(--cmx-[a-z-]+)'/g)].map((m) => m[1]));

for (const file of cssFiles) {
  const css = fs.readFileSync(file, 'utf8');
  const declared = new Set([...css.matchAll(/(--cmx-[a-z-]+)\s*:/g)].map((m) => m[1]));

  for (const match of css.matchAll(/var\((--cmx-[a-z-]+)([^)]*)\)/g)) {
    const name = match[1];
    const hasFallback = match[2].includes(',');
    if (!produced.has(name) && !declared.has(name) && !hasFallback) {
      problems.push(`${rel(file)} uses ${name}, which no theme defines and which has no fallback`);
    }
  }
}
notes.push(`checked ${cssFiles.length} stylesheets against ${produced.size} theme variables`);

// ---------------------------------------------------- worker/manifest ----

const worker = fs.readFileSync(path.join(ROOT, 'src/background/service-worker.js'), 'utf8');
const mainScripts = manifest.content_scripts
  .find((entry) => entry.js.includes('src/content/boot.js')).js;
for (const file of mainScripts) {
  if (!worker.includes(`'${file}'`)) {
    problems.push(`service worker's dynamic script list is missing ${file}`);
  }
}
notes.push('dynamic and declarative content-script lists agree');

// -------------------------------------------------------------- output ---

for (const note of notes) console.log(`  ok  ${note}`);

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} found:\n`);
  for (const problem of problems) console.error(` !  ${problem}`);
  process.exit(1);
}

console.log('\nAll static checks passed.');
