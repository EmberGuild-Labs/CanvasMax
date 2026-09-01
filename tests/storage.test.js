'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLibs } = require('./helper');

const { storage } = loadLibs();

test('deepMerge overlays without mutating the base', () => {
  const base = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] };
  const merged = storage.deepMerge(base, { nested: { y: 9 }, b: 2 });

  assert.deepEqual(merged, { a: 1, nested: { x: 1, y: 9 }, list: [1, 2], b: 2 });
  assert.deepEqual(base.nested, { x: 1, y: 2 }, 'base is untouched');
  assert.notEqual(merged.list, base.list, 'arrays are cloned, not shared');
});

test('deepMerge replaces arrays wholesale rather than concatenating', () => {
  const merged = storage.deepMerge({ list: [1, 2, 3] }, { list: [9] });
  assert.deepEqual(merged.list, [9]);
});

test('deepMerge ignores undefined so a partial patch never clears a sibling', () => {
  const merged = storage.deepMerge({ a: 1, b: 2 }, { a: undefined, b: 3 });
  assert.deepEqual(merged, { a: 1, b: 3 });
});

test('deepMerge handles a non-object patch by cloning the base', () => {
  assert.deepEqual(storage.deepMerge({ a: 1 }, null), { a: 1 });
});

test('migrate stamps the current schema version onto a bare blob', () => {
  assert.equal(storage.migrate({}).version, storage.SCHEMA_VERSION);
  assert.equal(storage.migrate(undefined).version, storage.SCHEMA_VERSION);
});

test('migrate leaves an already-current blob alone', () => {
  const blob = { version: storage.SCHEMA_VERSION, enabled: false };
  assert.deepEqual(storage.migrate(blob), blob);
});

test('defaults cover every settings branch the features read', () => {
  const d = storage.DEFAULTS;
  for (const key of ['theme', 'dashboard', 'todo', 'gpa', 'whatIf', 'preview', 'tweaks', 'reminders']) {
    assert.ok(d[key], `DEFAULTS is missing ${key}`);
  }
  assert.equal(d.enabled, true);
  assert.equal(d.theme.mode, 'system');
  assert.ok(Array.isArray(d.dashboard.cardLinks));
  assert.ok(Array.isArray(d.reminders.leadMinutes));
});

test('getSettings returns a fully populated tree on a fresh profile', async () => {
  const settings = await storage.getSettings({ fresh: true });
  assert.equal(settings.version, storage.SCHEMA_VERSION);
  assert.equal(settings.theme.darkTheme, 'midnight');
  assert.equal(settings.dashboard.gradeDisplay, 'both');
});

test('saveSettings merges a partial patch and keeps siblings', async () => {
  await storage.resetSettings();
  const next = await storage.saveSettings({ theme: { mode: 'dark' } });

  assert.equal(next.theme.mode, 'dark');
  assert.equal(next.theme.darkTheme, 'midnight', 'sibling survives the patch');
  assert.equal(next.dashboard.showGrades, true, 'unrelated branch survives');
});

test('saveSettings can write deep into a map', async () => {
  await storage.resetSettings();
  const next = await storage.saveSettings({ gpa: { credits: { 123: 4 } } });
  assert.equal(next.gpa.credits['123'], 4);

  const later = await storage.saveSettings({ gpa: { credits: { 456: 3 } } });
  assert.equal(later.gpa.credits['123'], 4, 'earlier entries are kept');
  assert.equal(later.gpa.credits['456'], 3);
});

test('replaceSettings swaps the whole tree and re-applies defaults', async () => {
  await storage.saveSettings({ theme: { mode: 'dark' } });
  const replaced = await storage.replaceSettings({ enabled: false });

  assert.equal(replaced.enabled, false);
  assert.equal(replaced.theme.mode, 'system', 'unspecified branches return to defaults');
});

test('resetSettings restores the defaults exactly', async () => {
  await storage.saveSettings({ enabled: false, theme: { mode: 'dark' } });
  const reset = await storage.resetSettings();

  assert.equal(reset.enabled, true);
  assert.equal(reset.theme.mode, 'system');
});

test('local key-value storage round-trips and honours a fallback', async () => {
  assert.equal(await storage.getLocal('nope', 'fallback'), 'fallback');
  await storage.setLocal('notes:https://x', 'hello');
  assert.equal(await storage.getLocal('notes:https://x'), 'hello');
  await storage.removeLocal('notes:https://x');
  assert.equal(await storage.getLocal('notes:https://x', ''), '');
});
