'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLibs, loadFeature } = require('./helper');

const { util, storage } = loadLibs();
require('../src/lib/fonts.js');
const { fonts } = globalThis.CanvasMax;

// ------------------------------------------------------------- colours ----

test('parseCssColor reads the forms getComputedStyle returns', () => {
  assert.deepEqual(util.parseCssColor('rgb(255, 255, 255)'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(util.parseCssColor('rgba(20, 30, 40, 0.5)'), { r: 20, g: 30, b: 40, a: 0.5 });
  assert.deepEqual(util.parseCssColor('rgb(1 2 3 / 50%)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.equal(util.parseCssColor('transparent'), null);
  assert.equal(util.parseCssColor(''), null);
});

test('parseCssColor still accepts hex', () => {
  assert.deepEqual(util.parseCssColor('#0f1419'), { r: 15, g: 20, b: 25, a: 1 });
});

test('isConvertibleSurface matches the white panels dark mode leaves behind', () => {
  assert.equal(util.isConvertibleSurface('rgb(255, 255, 255)'), true);
  assert.equal(util.isConvertibleSurface('rgb(245, 246, 248)'), true, 'near-white greys count');
  assert.equal(util.isConvertibleSurface('rgb(238, 242, 247)'), true);
});

test('isConvertibleSurface leaves saturated colours alone', () => {
  // Repainting these would destroy meaning: they are status chips and accents.
  assert.equal(util.isConvertibleSurface('rgb(120, 220, 120)'), false, 'green success chip');
  assert.equal(util.isConvertibleSurface('rgb(255, 210, 120)'), false, 'amber warning chip');
  assert.equal(util.isConvertibleSurface('rgb(79, 140, 255)'), false, 'brand accent');
});

test('isConvertibleSurface ignores transparent and already-dark surfaces', () => {
  assert.equal(util.isConvertibleSurface('rgba(0, 0, 0, 0)'), false);
  assert.equal(util.isConvertibleSurface('rgba(255, 255, 255, 0.1)'), false, 'mostly transparent');
  assert.equal(util.isConvertibleSurface('rgb(23, 29, 38)'), false);
});

test('isDarkInk spots text that would vanish on a dark panel', () => {
  assert.equal(util.isDarkInk('rgb(45, 59, 69)'), true, "Canvas's default ink");
  assert.equal(util.isDarkInk('rgb(0, 0, 0)'), true);
  assert.equal(util.isDarkInk('rgb(229, 234, 240)'), false, 'already light');
  assert.equal(util.isDarkInk('rgba(0, 0, 0, 0)'), false, 'invisible text is not our problem');
});

test('saturationRgb separates greys from colours', () => {
  assert.equal(util.saturationRgb({ r: 200, g: 200, b: 200 }), 0);
  assert.ok(util.saturationRgb({ r: 255, g: 0, b: 0 }) > 0.9);
});

// --------------------------------------------------------------- fonts ----

test('sanitizeFamily quotes a legitimate family name', () => {
  assert.equal(fonts.sanitizeFamily('Source Sans 3'), '"Source Sans 3"');
  assert.equal(fonts.sanitizeFamily('  JetBrains Mono  '), '"JetBrains Mono"');
});

test('sanitizeFamily refuses anything that could escape the declaration', () => {
  // The family name comes from a text field, so this is the security boundary.
  assert.equal(fonts.sanitizeFamily('x; } body { display:none'), '');
  assert.equal(fonts.sanitizeFamily('Arial, sans-serif; color: red'), '');
  assert.equal(fonts.sanitizeFamily('url(evil)'), '');
  assert.equal(fonts.sanitizeFamily('<script>'), '');
  assert.equal(fonts.sanitizeFamily(''), '');
  assert.equal(fonts.sanitizeFamily(null), '');
});

test('compileFontCss emits a rule per role that is set', () => {
  const css = fonts.compileFontCss({ headings: 'Archivo', mono: 'JetBrains Mono' });
  assert.match(css, /"Archivo"/);
  assert.match(css, /"JetBrains Mono"/);
  assert.match(css, /html h1/);
  assert.match(css, /html code/);
  assert.ok(!css.includes('html body'), 'the unset ui role emits nothing');
});

test('compileFontCss always appends a fallback stack', () => {
  const css = fonts.compileFontCss({ body: 'Lora' });
  assert.match(css, /"Lora", Georgia/);
});

test('compileFontCss clamps the text scale and skips it at 100', () => {
  assert.match(fonts.compileFontCss({}, 400), /font-size: 150%/);
  assert.match(fonts.compileFontCss({}, 10), /font-size: 75%/);
  assert.equal(fonts.compileFontCss({}, 100), '');
});

test('compileFontCss returns nothing when no role is set', () => {
  assert.equal(fonts.compileFontCss({}), '');
  assert.equal(fonts.compileFontCss(), '');
});

test('googleFontsUrl builds a css2 request for each family', () => {
  const url = fonts.googleFontsUrl(['Inter', 'Source Serif 4']);
  assert.match(url, /^https:\/\/fonts\.googleapis\.com\/css2\?/);
  assert.match(url, /family=Inter:wght@400;700/);
  assert.match(url, /family=Source\+Serif\+4:wght@400;700/);
});

test('googleFontsUrl rejects families that are not plain names', () => {
  assert.equal(fonts.googleFontsUrl(['<script>']), null);
  assert.equal(fonts.googleFontsUrl(['a"b']), null);
  assert.equal(fonts.googleFontsUrl([]), null);
});

test('googleFontsUrl de-duplicates', () => {
  const url = fonts.googleFontsUrl(['Inter', 'Inter']);
  assert.equal(url.match(/family=/g).length, 1);
});

test('extractFontUrls finds every gstatic file in a stylesheet', () => {
  const css = `
    @font-face { src: url(https://fonts.gstatic.com/s/inter/a.woff2) format('woff2'); }
    @font-face { src: url(https://fonts.gstatic.com/s/inter/b.woff2) format('woff2'); }
    @font-face { src: url(https://evil.example.com/c.woff2); }
  `;
  const urls = fonts.extractFontUrls(css);
  assert.equal(urls.length, 2, 'only gstatic URLs are followed');
  assert.ok(urls.every((u) => u.startsWith('https://fonts.gstatic.com/')));
});

// ---------------------------------------------------------- background ----

const { appearance } = loadFeature('content/features/appearance.js');

test('safeImageUrl accepts data and https images only', () => {
  assert.ok(appearance.safeImageUrl('data:image/jpeg;base64,abc'));
  assert.ok(appearance.safeImageUrl('https://example.com/a.jpg'));
  assert.equal(appearance.safeImageUrl('http://example.com/a.jpg'), null, 'plain http is refused');
  assert.equal(appearance.safeImageUrl('javascript:alert(1)'), null);
  assert.equal(appearance.safeImageUrl('data:text/html,<script>'), null);
  assert.equal(appearance.safeImageUrl(''), null);
  assert.equal(appearance.safeImageUrl(null), null);
});

test('safeImageUrl refuses a url that could break out of the css function', () => {
  assert.equal(appearance.safeImageUrl('https://a.com/x.jpg") ; background: red; ("'), null);
});

test('every fit option maps to a real background-size', () => {
  for (const [name, def] of Object.entries(appearance.FIT)) {
    assert.ok(def.size, `${name} has no size`);
    assert.ok(def.repeat, `${name} has no repeat`);
  }
});

// ----------------------------------------------------------- migration ----

test('the v1 to v2 migration moves the single font onto the interface role', () => {
  const migrated = storage.migrate({ version: 1, theme: { font: { family: 'Comic Sans MS', scale: 120 } } });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.theme.fonts.ui, 'Comic Sans MS');
  assert.equal(migrated.theme.font.scale, 120, 'the scale is untouched');
});

test('the migration leaves a blob with no font alone', () => {
  const migrated = storage.migrate({ version: 1, theme: {} });
  assert.equal(migrated.version, 2);
  assert.ok(!migrated.theme.fonts?.ui);
});

test('defaults carry the new appearance settings', async () => {
  const defaults = await storage.getSettings({ fresh: true });
  assert.equal(defaults.theme.autoFixSurfaces, true);
  assert.equal(defaults.theme.background.enabled, false);
  assert.equal(defaults.theme.background.fit, 'cover');
  assert.deepEqual(defaults.theme.googleFonts, []);
  assert.deepEqual(defaults.theme.fonts, { ui: '', headings: '', body: '', mono: '' });
});
