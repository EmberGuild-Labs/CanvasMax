'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const exists = (relativePath) => fs.existsSync(path.join(ROOT, relativePath));

test('the manifest is Manifest V3', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.name);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test('every file the manifest references exists', () => {
  const referenced = [
    manifest.background.service_worker,
    manifest.options_ui.page,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
  ];

  for (const file of referenced) {
    assert.ok(exists(file), `manifest references a missing file: ${file}`);
  }
});

test('the extension asks only for the permissions it uses', () => {
  // Widening this list should be a deliberate decision, so it is asserted.
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ['alarms', 'notifications', 'scripting', 'storage']
  );
});

test('host access defaults to Canvas only, with everything else opt-in', () => {
  assert.deepEqual(manifest.host_permissions, ['*://*.instructure.com/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['*://*/*']);
});

test('the theme runs at document_start so pages do not flash', () => {
  const early = manifest.content_scripts.find((entry) => entry.js.includes('src/content/early.js'));
  assert.ok(early, 'no document_start entry');
  assert.equal(early.run_at, 'document_start');
  assert.ok(early.css.includes('src/content/theme.css'));
});

test('boot.js loads after the libraries and features it depends on', () => {
  const main = manifest.content_scripts.find((entry) => entry.js.includes('src/content/boot.js'));
  const scripts = main.js;

  assert.equal(scripts[scripts.length - 1], 'src/content/boot.js', 'boot must be last');

  for (const lib of ['util', 'storage', 'canvas-api', 'themes', 'grades', 'gpa']) {
    const libIndex = scripts.indexOf(`src/lib/${lib}.js`);
    assert.ok(libIndex >= 0, `lib/${lib}.js is not injected`);
    assert.ok(libIndex < scripts.indexOf('src/content/boot.js'), `lib/${lib}.js must precede boot.js`);
  }

  // grades.js defines the scheme gpa.js reads at load time.
  assert.ok(
    scripts.indexOf('src/lib/grades.js') < scripts.indexOf('src/content/features/gpa-panel.js'),
    'grades.js must precede the GPA panel'
  );
});

test('the service worker injects the same scripts the manifest does', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'src/background/service-worker.js'), 'utf8');
  const manifestScripts = manifest.content_scripts
    .find((entry) => entry.js.includes('src/content/boot.js')).js;

  // Dynamically-registered scripts for custom domains must stay in sync with
  // the declarative ones, or those users silently lose features.
  for (const file of manifestScripts) {
    assert.ok(worker.includes(`'${file}'`), `service worker is missing ${file}`);
  }
});

test('the package version matches the manifest version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, manifest.version);
});
