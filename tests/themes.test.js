'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLibs } = require('./helper');

const { themes, util } = loadLibs();
require('../src/lib/fonts.js');

test('every built-in theme defines all required colors', () => {
  for (const theme of Object.values(themes.BUILTIN_THEMES)) {
    for (const key of themes.REQUIRED_COLORS) {
      assert.ok(theme.colors[key], `${theme.id} is missing colors.${key}`);
      assert.ok(util.parseHex(theme.colors[key]), `${theme.id}.${key} is not a hex color`);
    }
  }
});

test('every built-in theme meets its contrast targets', () => {
  for (const theme of Object.values(themes.BUILTIN_THEMES)) {
    for (const check of themes.auditContrast(theme)) {
      assert.ok(check.pass, `${theme.id}: ${check.label} is only ${check.ratio}:1, needs ${check.min}`);
    }
  }
});

test('themeVariables emits every custom property the stylesheet uses', () => {
  const vars = themes.themeVariables(themes.BUILTIN_THEMES.midnight);
  for (const key of ['--cmx-bg', '--cmx-surface', '--cmx-text', '--cmx-accent', '--cmx-radius', '--cmx-scheme']) {
    assert.ok(key in vars, `missing ${key}`);
  }
  assert.equal(vars['--cmx-scheme'], 'dark');
});

test('compileTheme produces a parseable :root rule', () => {
  const css = themes.compileTheme(themes.BUILTIN_THEMES.paper);
  assert.match(css, /^:root \{/);
  assert.match(css, /--cmx-bg: #faf8f5;/);
  assert.match(css, /\}$/);
});

test('normalizeTheme fills in gaps from a sensible base', () => {
  const theme = themes.normalizeTheme({ name: 'Half', colors: { bg: '#101010' } });
  assert.equal(theme.colors.bg, '#101010');
  assert.ok(theme.colors.accent, 'accent should be inherited');
  assert.equal(theme.dark, true);
});

test('a light theme normalizes against the light base', () => {
  const theme = themes.normalizeTheme({ name: 'L', dark: false, colors: {} });
  assert.equal(theme.colors.bg, themes.BUILTIN_THEMES['canvas-light'].colors.bg);
});

test('resolveTheme prefers a user theme, then a built-in, then a default', () => {
  const custom = { mine: { id: 'mine', name: 'Mine', dark: true, colors: { bg: '#010203' } } };
  assert.equal(themes.resolveTheme('mine', custom).colors.bg, '#010203');
  assert.equal(themes.resolveTheme('carbon', custom).id, 'carbon');
  assert.equal(themes.resolveTheme('does-not-exist', custom).id, 'midnight');
});

test('validateTheme rejects malformed input with a reason', () => {
  assert.equal(themes.validateTheme(null).ok, false);
  assert.equal(themes.validateTheme({ colors: {} }).ok, false);
  assert.match(themes.validateTheme({ colors: {} }).errors[0], /name/);

  const badColor = themes.validateTheme({ name: 'X', colors: { bg: 'rebeccapurple' } });
  assert.equal(badColor.ok, false);
  assert.match(badColor.errors[0], /colors\.bg/);
});

test('validateTheme accepts a complete theme and normalizes it', () => {
  const result = themes.validateTheme({
    name: 'Mine',
    dark: true,
    colors: { bg: '#000', surface: '#111', accent: '#4f8cff' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.theme.name, 'Mine');
  assert.ok(result.theme.colors.text, 'missing colors are filled in');
});

test('slugify makes stable ids and avoids collisions', () => {
  assert.equal(themes.slugify('My Cool Theme!'), 'my-cool-theme');
  assert.equal(themes.slugify('Midnight'), 'midnight-2', 'must not shadow a built-in');
  assert.equal(themes.slugify('X', { x: {} }), 'x-2');
  assert.equal(themes.slugify(''), 'theme');
});

test('shouldUseDark honours each mode', () => {
  const at = (h, m = 0) => new Date(2026, 0, 15, h, m);
  const base = { theme: { schedule: { start: '19:00', end: '07:00' } } };

  assert.equal(themes.shouldUseDark({ theme: { ...base.theme, mode: 'dark' } }), true);
  assert.equal(themes.shouldUseDark({ theme: { ...base.theme, mode: 'light' } }), false);
  assert.equal(themes.shouldUseDark({ theme: { ...base.theme, mode: 'system' } }, at(3), true), true);
  assert.equal(themes.shouldUseDark({ theme: { ...base.theme, mode: 'system' } }, at(3), false), false);
  assert.equal(themes.shouldUseDark({ theme: { ...base.theme, mode: 'schedule' } }, at(22)), true);
  assert.equal(themes.shouldUseDark({ theme: { ...base.theme, mode: 'schedule' } }, at(12)), false);
});

test('a schedule that wraps past midnight is handled', () => {
  const at = (h, m = 0) => new Date(2026, 0, 15, h, m);
  assert.equal(themes.isWithinSchedule(at(23, 30), '19:00', '07:00'), true);
  assert.equal(themes.isWithinSchedule(at(3), '19:00', '07:00'), true);
  assert.equal(themes.isWithinSchedule(at(7), '19:00', '07:00'), false, 'end is exclusive');
  assert.equal(themes.isWithinSchedule(at(18, 59), '19:00', '07:00'), false);
});

test('a same-day schedule window works too', () => {
  const at = (h) => new Date(2026, 0, 15, h);
  assert.equal(themes.isWithinSchedule(at(10), '09:00', '17:00'), true);
  assert.equal(themes.isWithinSchedule(at(20), '09:00', '17:00'), false);
});

test('an empty or malformed schedule never claims to be active', () => {
  const now = new Date(2026, 0, 15, 12);
  assert.equal(themes.isWithinSchedule(now, '12:00', '12:00'), false);
  assert.equal(themes.isWithinSchedule(now, 'nonsense', '07:00'), false);
});

test('compilePreferences delegates typography to the font roles', () => {
  // Typography moved into fonts.js so the pre-paint boot cache and the live
  // page compile it identically; this asserts the delegation still happens.
  const css = themes.compilePreferences({
    theme: { fonts: { ui: 'Inter' }, font: { scale: 300 }, customCss: '' },
    tweaks: {},
  });
  assert.match(css, /font-family: "Inter"/);
  assert.match(css, /font-size: 150%/, 'scale is clamped to 150');
});

test('compilePreferences refuses a family that could break out of the rule', () => {
  const css = themes.compilePreferences({
    theme: { fonts: { ui: 'Evil}; body{display:none' }, font: { scale: 100 } },
    tweaks: {},
  });
  assert.ok(!css.includes('}; body{'), 'braces must not survive');
  assert.equal(css, '', 'the whole family is rejected, not partially stripped');
});

test('compilePreferences emits nothing when no preferences are set', () => {
  assert.equal(themes.compilePreferences({ theme: { fonts: {}, font: {} }, tweaks: {} }), '');
});
