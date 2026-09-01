'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLibs, makeGroups } = require('./helper');

const { grades } = loadLibs();

test('letterForPercent uses Canvas default cutoffs', () => {
  assert.equal(grades.letterForPercent(100), 'A');
  assert.equal(grades.letterForPercent(94), 'A');
  assert.equal(grades.letterForPercent(93.9), 'A-');
  assert.equal(grades.letterForPercent(90), 'A-');
  assert.equal(grades.letterForPercent(89.99), 'B+');
  assert.equal(grades.letterForPercent(70), 'C-');
  assert.equal(grades.letterForPercent(60.9), 'F');
  assert.equal(grades.letterForPercent(0), 'F');
});

test('letterForPercent rounds to two places before comparing, like Canvas', () => {
  // 93.999 rounds to 94.00, which meets the A cutoff.
  assert.equal(grades.letterForPercent(93.999), 'A');
  assert.equal(grades.letterForPercent(93.994), 'A-');
});

test('letterForPercent returns null when there is no score', () => {
  assert.equal(grades.letterForPercent(null), null);
  assert.equal(grades.letterForPercent(undefined), null);
});

test('normalizeScheme converts Canvas fractional standards to percentages', () => {
  const scheme = grades.normalizeScheme([
    { name: 'A', value: 0.93 },
    { name: 'B', value: 0.85 },
    { name: 'F', value: 0 },
  ]);
  assert.deepEqual(scheme, [['A', 93], ['B', 85], ['F', 0]]);
  assert.equal(grades.letterForPercent(93.5, scheme), 'A');
  assert.equal(grades.letterForPercent(92, scheme), 'B');
});

test('normalizeScheme falls back to the default for junk input', () => {
  assert.equal(grades.normalizeScheme(null), grades.DEFAULT_GRADING_SCHEME);
  assert.equal(grades.normalizeScheme([]), grades.DEFAULT_GRADING_SCHEME);
});

test('unweighted course grade is total points earned over total possible', () => {
  const groups = makeGroups([
    { name: 'Homework', assignments: [{ possible: 100, score: 90 }] },
    { name: 'Exams', assignments: [{ possible: 200, score: 140 }] },
  ]);
  const result = grades.computeCourseGrade(groups);
  assert.equal(result.weighted, false);
  assert.equal(result.earned, 230);
  assert.equal(result.possible, 300);
  assert.ok(Math.abs(result.percent - 76.6667) < 0.001);
});

test('weighted course grade combines group percentages by weight', () => {
  const groups = makeGroups([
    { name: 'Homework', weight: 40, assignments: [{ possible: 100, score: 90 }] },
    { name: 'Exams', weight: 60, assignments: [{ possible: 200, score: 140 }] },
  ]);
  const result = grades.computeCourseGrade(groups);
  assert.equal(result.weighted, true);
  // 0.4 * 90% + 0.6 * 70% = 78%
  assert.ok(Math.abs(result.percent - 78) < 1e-9);
});

test('weighted groups with no graded work are dropped and weights renormalised', () => {
  const groups = makeGroups([
    { name: 'Homework', weight: 30, assignments: [{ possible: 100, score: 80 }] },
    { name: 'Final', weight: 70, assignments: [{ possible: 100 }] }, // ungraded
  ]);
  const result = grades.computeCourseGrade(groups);
  // Only Homework has data, so it carries the whole grade rather than the
  // student showing 24% in week one.
  assert.ok(Math.abs(result.percent - 80) < 1e-9);
  assert.equal(result.availableWeight, 30);
});

test('final grade mode counts ungraded work as zero', () => {
  const groups = makeGroups([
    { name: 'Homework', weight: 30, assignments: [{ possible: 100, score: 80 }] },
    { name: 'Final', weight: 70, assignments: [{ possible: 100 }] },
  ]);
  const result = grades.computeCourseGrade(groups, { treatUngradedAsZero: true });
  // 0.3 * 80% + 0.7 * 0% = 24%
  assert.ok(Math.abs(result.percent - 24) < 1e-9);
});

test('excused submissions are ignored entirely', () => {
  const groups = makeGroups([
    {
      name: 'Homework',
      assignments: [
        { possible: 100, score: 90 },
        { possible: 100, excused: true },
      ],
    },
  ]);
  const result = grades.computeCourseGrade(groups);
  assert.equal(result.possible, 100);
  assert.equal(result.percent, 90);
});

test('assignments flagged omit_from_final_grade do not count', () => {
  const groups = makeGroups([
    {
      name: 'Homework',
      assignments: [
        { possible: 100, score: 90 },
        { possible: 100, score: 0, omit: true },
      ],
    },
  ]);
  assert.equal(grades.computeCourseGrade(groups).percent, 90);
});

test('not_graded assignments do not count', () => {
  const groups = makeGroups([
    {
      name: 'Homework',
      assignments: [
        { possible: 100, score: 90 },
        { possible: 50, score: 0, types: ['not_graded'] },
      ],
    },
  ]);
  assert.equal(grades.computeCourseGrade(groups).percent, 90);
});

test('a course with nothing graded reports null rather than zero', () => {
  const groups = makeGroups([{ name: 'Homework', assignments: [{ possible: 100 }] }]);
  assert.equal(grades.computeCourseGrade(groups).percent, null);
});

test('what-if overrides replace the real score', () => {
  const groups = makeGroups([
    { name: 'Homework', weight: 40, assignments: [{ id: 'hw1', possible: 100, score: 90 }] },
    { name: 'Exams', weight: 60, assignments: [{ id: 'ex1', possible: 200, score: 140 }] },
  ]);
  const result = grades.computeCourseGrade(groups, { overrides: { ex1: 200 } });
  // 0.4 * 90% + 0.6 * 100% = 96%
  assert.ok(Math.abs(result.percent - 96) < 1e-9);
});

test('a null override excludes the assignment from the calculation', () => {
  const groups = makeGroups([
    {
      name: 'Homework',
      assignments: [
        { id: 'a', possible: 100, score: 100 },
        { id: 'b', possible: 100, score: 0 },
      ],
    },
  ]);
  assert.equal(grades.computeCourseGrade(groups).percent, 50);
  assert.equal(grades.computeCourseGrade(groups, { overrides: { b: null } }).percent, 100);
});

test('an override on an ungraded assignment brings it into the grade', () => {
  const groups = makeGroups([
    { name: 'Homework', assignments: [{ id: 'a', possible: 100, score: 80 }] },
    { name: 'Final', assignments: [{ id: 'f', possible: 100 }] },
  ]);
  assert.equal(grades.computeCourseGrade(groups).percent, 80);
  assert.equal(grades.computeCourseGrade(groups, { overrides: { f: 100 } }).percent, 90);
});

test('pointsNeededFor solves for the score that reaches a target', () => {
  const groups = makeGroups([
    { name: 'Work', assignments: [
      { id: 'a', possible: 100, score: 80 },
      { id: 'final', possible: 100 },
    ] },
  ]);
  const needed = grades.pointsNeededFor(groups, 'final', 90);
  // (80 + x) / 200 = 0.90  ->  x = 100
  assert.ok(Math.abs(needed.points - 100) < 1e-6);
  assert.equal(needed.achievable, true);
});

test('pointsNeededFor reports an unreachable target', () => {
  const groups = makeGroups([
    { name: 'Work', assignments: [
      { id: 'a', possible: 100, score: 40 },
      { id: 'final', possible: 100 },
    ] },
  ]);
  const needed = grades.pointsNeededFor(groups, 'final', 95);
  assert.equal(needed.achievable, false);
  assert.ok(needed.points > 100);
});

test('pointsNeededFor reports a target already met', () => {
  const groups = makeGroups([
    { name: 'Work', assignments: [
      { id: 'a', possible: 100, score: 100 },
      { id: 'final', possible: 100 },
    ] },
  ]);
  const needed = grades.pointsNeededFor(groups, 'final', 45);
  assert.equal(needed.alreadyThere, true);
});

test('pointsNeededFor returns null for a zero-point assignment', () => {
  const groups = makeGroups([
    { name: 'Work', assignments: [{ id: 'x', possible: 0 }] },
  ]);
  assert.equal(grades.pointsNeededFor(groups, 'x', 90), null);
});

test('percentFromCourse prefers the current grading period score', () => {
  const course = {
    enrollments: [{
      type: 'student',
      computed_current_score: 71,
      current_period_computed_current_score: 88,
    }],
  };
  assert.equal(grades.percentFromCourse(course), 88);
});

test('percentFromCourse falls back to the overall computed score', () => {
  const course = { enrollments: [{ type: 'student', computed_current_score: 71 }] };
  assert.equal(grades.percentFromCourse(course), 71);
});

test('percentFromCourse returns null when the course hides totals', () => {
  assert.equal(grades.percentFromCourse({ enrollments: [{ type: 'student' }] }), null);
  assert.equal(grades.percentFromCourse({ enrollments: [] }), null);
  assert.equal(grades.percentFromCourse(null), null);
});

test('letterFromCourse prefers the grade Canvas reports over a derived one', () => {
  const course = { enrollments: [{ type: 'student', computed_current_score: 91, computed_current_grade: 'A' }] };
  assert.equal(grades.letterFromCourse(course), 'A');
});

test('formatPercent trims trailing zeros', () => {
  assert.equal(grades.formatPercent(90), '90%');
  assert.equal(grades.formatPercent(76.6666), '76.67%');
  assert.equal(grades.formatPercent(null), null);
});

test('flattenAssignments tags each assignment with its group', () => {
  const groups = makeGroups([
    { name: 'Homework', assignments: [{ id: 'a', possible: 10, score: 10 }] },
    { name: 'Exams', assignments: [{ id: 'b', possible: 10, score: 5 }] },
  ]);
  const flat = grades.flattenAssignments(groups);
  assert.equal(flat.length, 2);
  assert.equal(flat[0].groupName, 'Homework');
  assert.equal(flat[1].groupName, 'Exams');
});
