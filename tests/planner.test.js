'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLibs, loadFeature } = require('./helper');

loadLibs();
const { todo } = loadFeature('content/features/todo.js');

const NOW = new Date('2026-03-10T12:00:00Z');

/** Shape a planner item the way /api/v1/planner/items returns one. */
function plannerItem(overrides = {}) {
  return {
    plannable_type: 'assignment',
    plannable_id: '1',
    plannable_date: '2026-03-12T23:59:00Z',
    course_id: '42',
    context_name: 'Organic Chemistry',
    html_url: '/courses/42/assignments/1',
    submissions: {},
    plannable: { id: '1', title: 'Problem set 4', points_possible: 20 },
    ...overrides,
  };
}

test('normalizeItem pulls out the fields the panel renders', () => {
  const item = todo.normalizeItem(plannerItem(), NOW);
  assert.equal(item.title, 'Problem set 4');
  assert.equal(item.typeLabel, 'Assignment');
  assert.equal(item.courseId, '42');
  assert.equal(item.contextName, 'Organic Chemistry');
  assert.equal(item.points, 20);
  assert.equal(item.complete, false);
  assert.equal(item.overdue, false);
  assert.equal(item.key, 'assignment:1');
});

test('a submitted item counts as complete', () => {
  const item = todo.normalizeItem(plannerItem({ submissions: { submitted: true } }), NOW);
  assert.equal(item.complete, true);
});

test('a graded or excused item counts as complete', () => {
  assert.equal(todo.normalizeItem(plannerItem({ submissions: { graded: true } }), NOW).complete, true);
  assert.equal(todo.normalizeItem(plannerItem({ submissions: { excused: true } }), NOW).complete, true);
});

test('a manual planner override marks an item complete', () => {
  const item = todo.normalizeItem(
    plannerItem({ planner_override: { id: '9', marked_complete: true } }),
    NOW
  );
  assert.equal(item.complete, true);
});

test('a past deadline with nothing submitted is overdue', () => {
  const item = todo.normalizeItem(plannerItem({ plannable_date: '2026-03-01T23:59:00Z' }), NOW);
  assert.equal(item.overdue, true);
});

test('a past deadline that was submitted is not overdue', () => {
  const item = todo.normalizeItem(
    plannerItem({ plannable_date: '2026-03-01T23:59:00Z', submissions: { submitted: true } }),
    NOW
  );
  assert.equal(item.overdue, false);
});

test('a past calendar event is never treated as overdue work', () => {
  const item = todo.normalizeItem(plannerItem({
    plannable_type: 'calendar_event',
    plannable_date: '2026-03-01T10:00:00Z',
  }), NOW);
  assert.equal(item.overdue, false);
  assert.equal(item.typeLabel, 'Event');
});

test('an item with no date is kept but carries no due date', () => {
  const item = todo.normalizeItem(plannerItem({
    plannable_date: null,
    plannable: { id: '1', title: 'Reading' },
  }), NOW);
  assert.equal(item.date, null);
  assert.equal(item.points, null);
});

test('an unparseable date is rejected rather than rendered as Invalid Date', () => {
  assert.equal(todo.normalizeItem(plannerItem({ plannable_date: 'not-a-date' }), NOW), null);
});

test('a planner note falls back to its own title', () => {
  const item = todo.normalizeItem(plannerItem({
    plannable_type: 'planner_note',
    plannable: { id: '5', title: 'Buy the lab manual', todo_date: '2026-03-11T00:00:00Z' },
  }), NOW);
  assert.equal(item.typeLabel, 'Note');
  assert.equal(item.title, 'Buy the lab manual');
});

test('missing and late flags are carried through', () => {
  const item = todo.normalizeItem(plannerItem({ submissions: { missing: true, late: true } }), NOW);
  assert.equal(item.missing, true);
  assert.equal(item.late, true);
});

test('groupItems puts overdue work in its own group, first', () => {
  const items = [
    todo.normalizeItem(plannerItem({ plannable_id: '1', plannable_date: '2026-03-01T23:59:00Z' }), NOW),
    todo.normalizeItem(plannerItem({ plannable_id: '2', plannable_date: '2026-03-12T23:59:00Z' }), NOW),
  ];
  const groups = todo.groupItems(items, { groupBy: 'date', now: NOW });

  assert.equal(groups[0].label, 'Overdue');
  assert.equal(groups[0].overdue, true);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups.length, 2);
});

test('groupItems buckets by day and sorts chronologically', () => {
  const items = [
    todo.normalizeItem(plannerItem({ plannable_id: '2', plannable_date: '2026-03-14T09:00:00Z' }), NOW),
    todo.normalizeItem(plannerItem({ plannable_id: '1', plannable_date: '2026-03-12T23:59:00Z' }), NOW),
    todo.normalizeItem(plannerItem({ plannable_id: '3', plannable_date: '2026-03-12T08:00:00Z' }), NOW),
  ];
  const groups = todo.groupItems(items, { groupBy: 'date', now: NOW });

  assert.equal(groups.length, 2, 'two distinct days');
  assert.equal(groups[0].items.length, 2, 'both 12 March items share a bucket');
  assert.equal(groups[0].items[0].key, 'assignment:3', 'earlier time first');
});

test('groupItems can bucket by course instead', () => {
  const items = [
    todo.normalizeItem(plannerItem({ plannable_id: '1', context_name: 'Physics' }), NOW),
    todo.normalizeItem(plannerItem({ plannable_id: '2', context_name: 'Art History' }), NOW),
    todo.normalizeItem(plannerItem({ plannable_id: '3', context_name: 'Physics' }), NOW),
  ];
  const groups = todo.groupItems(items, { groupBy: 'course', now: NOW });

  assert.deepEqual(groups.map((g) => g.label), ['Art History', 'Physics']);
  assert.equal(groups[1].items.length, 2);
});

test('undated items sort after dated ones', () => {
  const dated = todo.normalizeItem(plannerItem({ plannable_id: '1' }), NOW);
  const undated = todo.normalizeItem(
    plannerItem({ plannable_id: '2', plannable_date: null, plannable: { id: '2', title: 'Someday' } }),
    NOW
  );
  const groups = todo.groupItems([undated, dated], { groupBy: 'date', now: NOW });
  assert.equal(groups[groups.length - 1].label, 'No due date');
});

test('groupItems on an empty list returns no groups', () => {
  assert.deepEqual(todo.groupItems([], { groupBy: 'date', now: NOW }), []);
});
