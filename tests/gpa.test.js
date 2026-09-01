'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLibs } = require('./helper');

const { gpa } = loadLibs();

test('normalizeLetter tidies casing, spacing and unicode dashes', () => {
  assert.equal(gpa.normalizeLetter('a-'), 'A-');
  assert.equal(gpa.normalizeLetter(' B+ '), 'B+');
  assert.equal(gpa.normalizeLetter('A−'), 'A-'); // minus sign
  assert.equal(gpa.normalizeLetter('F-'), 'F');
  assert.equal(gpa.normalizeLetter('pass'), null);
  assert.equal(gpa.normalizeLetter(null), null);
});

test('gradePointsFor maps letters on the 4.0 scale', () => {
  assert.equal(gpa.gradePointsFor({ letter: 'A' }), 4.0);
  assert.equal(gpa.gradePointsFor({ letter: 'A+' }), 4.0);
  assert.equal(gpa.gradePointsFor({ letter: 'A-' }), 3.7);
  assert.equal(gpa.gradePointsFor({ letter: 'C' }), 2.0);
  assert.equal(gpa.gradePointsFor({ letter: 'F' }), 0);
});

test('the 4.3 scale rewards an A+', () => {
  assert.equal(gpa.gradePointsFor({ letter: 'A+' }, '4.3'), 4.3);
  assert.equal(gpa.gradePointsFor({ letter: 'A' }, '4.3'), 4.0);
});

test('a percentage is converted through the grading scheme when no letter exists', () => {
  assert.equal(gpa.gradePointsFor({ percent: 95 }), 4.0);
  assert.equal(gpa.gradePointsFor({ percent: 91 }), 3.7);
  assert.equal(gpa.gradePointsFor({ percent: 55 }), 0);
});

test('a course-specific grading scheme is respected', () => {
  const scheme = [['A', 98], ['B', 80], ['F', 0]];
  assert.equal(gpa.gradePointsFor({ percent: 95, scheme }), 3.0);
  assert.equal(gpa.gradePointsFor({ percent: 99, scheme }), 4.0);
});

test('gradePointsFor returns null when there is nothing to grade', () => {
  assert.equal(gpa.gradePointsFor({}), null);
  assert.equal(gpa.gradePointsFor({ percent: null, letter: null }), null);
});

test('the weighted high-school scale adds a rigor bonus', () => {
  assert.equal(gpa.gradePointsFor({ letter: 'A', rigor: 'ap' }, 'hs-weighted'), 5.0);
  assert.equal(gpa.gradePointsFor({ letter: 'A', rigor: 'honors' }, 'hs-weighted'), 4.5);
  assert.equal(gpa.gradePointsFor({ letter: 'B', rigor: 'ib' }, 'hs-weighted'), 4.0);
  assert.equal(gpa.gradePointsFor({ letter: 'A', rigor: 'regular' }, 'hs-weighted'), 4.0);
});

test('failing an AP class earns no rigor bonus', () => {
  assert.equal(gpa.gradePointsFor({ letter: 'F', rigor: 'ap' }, 'hs-weighted'), 0);
});

test('computeGPA weights each course by its credit hours', () => {
  const result = gpa.computeGPA([
    { name: 'Chem', percent: 95, credits: 4 },   // 4.0 * 4
    { name: 'History', letter: 'B+', credits: 3 }, // 3.3 * 3
  ]);
  assert.equal(result.totalCredits, 7);
  assert.ok(Math.abs(result.gpa - (16 + 9.9) / 7) < 1e-9);
});

test('courses with no grade are skipped, not counted as zero', () => {
  const result = gpa.computeGPA([
    { name: 'Chem', letter: 'A', credits: 3 },
    { name: 'Seminar', credits: 3 },
  ]);
  assert.equal(result.gpa, 4.0);
  assert.equal(result.totalCredits, 3);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'no grade yet');
});

test('a course can be excluded explicitly', () => {
  const result = gpa.computeGPA([
    { name: 'Chem', letter: 'A', credits: 3 },
    { name: 'PE', letter: 'F', credits: 3, include: false },
  ]);
  assert.equal(result.gpa, 4.0);
  assert.equal(result.skipped[0].reason, 'excluded');
});

test('missing credits default to one unit each', () => {
  const result = gpa.computeGPA([
    { name: 'A', letter: 'A' },
    { name: 'B', letter: 'C' },
  ]);
  assert.equal(result.totalCredits, 2);
  assert.equal(result.gpa, 3.0);
});

test('computeGPA returns null when nothing can be counted', () => {
  const result = gpa.computeGPA([{ name: 'Seminar' }]);
  assert.equal(result.gpa, null);
  assert.equal(result.totalCredits, 0);
});

test('an unknown scale falls back to 4.0 rather than throwing', () => {
  const result = gpa.computeGPA([{ letter: 'A', credits: 1 }], { scale: 'nonsense' });
  assert.equal(result.scaleKey, '4.0');
  assert.equal(result.gpa, 4.0);
});

test('gpaNeededForTarget solves for the term GPA required', () => {
  // 3.2 over 30 credits, 15 more credits, want a 3.5 overall.
  const needed = gpa.gpaNeededForTarget({
    currentGpa: 3.2, currentCredits: 30, plannedCredits: 15, targetGpa: 3.5,
  });
  assert.ok(Math.abs(needed - 4.1) < 1e-9);
});

test('gpaNeededForTarget guards against dividing by zero credits', () => {
  assert.equal(gpa.gpaNeededForTarget({
    currentGpa: 3, currentCredits: 10, plannedCredits: 0, targetGpa: 3.5,
  }), null);
});

test('formatGpa renders two decimal places', () => {
  assert.equal(gpa.formatGpa(3.6666), '3.67');
  assert.equal(gpa.formatGpa(4), '4.00');
  assert.equal(gpa.formatGpa(null), null);
});
