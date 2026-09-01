'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLibs, loadFeature } = require('./helper');

const { util } = loadLibs();
// boot.js self-invokes, but bails immediately because the stub DOM has none of
// the Canvas markers, so importing it here is safe.
const { boot } = loadFeature('content/boot.js');

test('detectPage recognises the dashboard', () => {
  assert.deepEqual(boot.detectPage('/'), { type: 'dashboard' });
  assert.deepEqual(boot.detectPage('/dashboard'), { type: 'dashboard' });
  assert.deepEqual(boot.detectPage('/dashboard/'), { type: 'dashboard' });
});

test('detectPage recognises course pages and their sections', () => {
  assert.deepEqual(boot.detectPage('/courses/42'), { type: 'course', courseId: '42' });
  assert.deepEqual(boot.detectPage('/courses/42/grades'), { type: 'grades', courseId: '42' });
  assert.deepEqual(boot.detectPage('/courses/42/modules'), { type: 'modules', courseId: '42' });
  assert.deepEqual(boot.detectPage('/courses/42/assignments'), { type: 'assignments', courseId: '42' });
});

test('detectPage extracts assignment and quiz ids', () => {
  assert.deepEqual(boot.detectPage('/courses/42/assignments/7'), {
    type: 'assignment', courseId: '42', assignmentId: '7',
  });
  assert.deepEqual(boot.detectPage('/courses/42/quizzes/9'), {
    type: 'quiz', courseId: '42', quizId: '9',
  });
});

test('an observer viewing a specific student still lands on the grades page', () => {
  assert.deepEqual(boot.detectPage('/courses/42/grades/1234'), { type: 'grades', courseId: '42' });
});

test('detectPage falls back to course-other for unmapped course sections', () => {
  assert.deepEqual(boot.detectPage('/courses/42/files/9'), {
    type: 'course-other', courseId: '42', section: 'files',
  });
});

test('detectPage recognises the top-level Canvas sections', () => {
  assert.equal(boot.detectPage('/grades').type, 'all-grades');
  assert.equal(boot.detectPage('/calendar').type, 'calendar');
  assert.equal(boot.detectPage('/conversations').type, 'inbox');
  assert.equal(boot.detectPage('/profile/settings').type, 'profile');
});

test('detectPage returns "other" for anything unrecognised', () => {
  assert.equal(boot.detectPage('/accounts/1/terms').type, 'other');
});

test('parseHex accepts every hex form and rejects the rest', () => {
  assert.deepEqual(util.parseHex('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(util.parseHex('0f1419'), { r: 15, g: 20, b: 25, a: 1 });
  assert.equal(util.parseHex('#0f141980').a, 128 / 255);
  assert.equal(util.parseHex('rebeccapurple'), null);
  assert.equal(util.parseHex(null), null);
});

test('contrastRatio matches the WCAG extremes', () => {
  assert.equal(Math.round(util.contrastRatio('#ffffff', '#000000')), 21);
  assert.equal(util.contrastRatio('#123456', '#123456'), 1);
});

test('readableTextOn picks dark ink on light backgrounds and vice versa', () => {
  assert.equal(util.readableTextOn('#ffffff'), '#12151a');
  assert.equal(util.readableTextOn('#ffe066'), '#12151a');
  assert.equal(util.readableTextOn('#0a2540'), '#ffffff');
  assert.equal(util.readableTextOn('#000000'), '#ffffff');
});

test('mix interpolates between two colors', () => {
  assert.equal(util.mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(util.mix('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(util.mix('#000000', '#ffffff', 0.5), '#808080');
});

test('mix clamps out-of-range amounts and passes through bad input', () => {
  assert.equal(util.mix('#000000', '#ffffff', 5), '#ffffff');
  assert.equal(util.mix('nonsense', '#ffffff', 0.5), 'nonsense');
});

test('colorFromString is deterministic and produces a valid hex', () => {
  const a = util.colorFromString('Organic Chemistry');
  assert.equal(a, util.colorFromString('Organic Chemistry'));
  assert.notEqual(a, util.colorFromString('Art History'));
  assert.ok(util.parseHex(a));
});

test('relativeDayLabel names the days around today', () => {
  const now = new Date(2026, 2, 10, 12);
  assert.equal(util.relativeDayLabel(new Date(2026, 2, 10, 23), now), 'Today');
  assert.equal(util.relativeDayLabel(new Date(2026, 2, 11, 1), now), 'Tomorrow');
  assert.equal(util.relativeDayLabel(new Date(2026, 2, 9, 23), now), 'Yesterday');
});

test('relativeDayLabel uses a weekday inside the coming week', () => {
  const now = new Date(2026, 2, 10, 12); // a Tuesday
  const label = util.relativeDayLabel(new Date(2026, 2, 13, 12), now);
  assert.match(label, /day$/, `expected a weekday name, got ${label}`);
});

test('formatDueDate handles a missing or invalid date', () => {
  assert.equal(util.formatDueDate(null), 'No due date');
  assert.equal(util.formatDueDate('not-a-date'), 'No due date');
});

test('escapeHtml neutralises markup', () => {
  assert.equal(util.escapeHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(util.escapeHtml(null), '');
});
