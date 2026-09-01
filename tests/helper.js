/**
 * Test harness.
 *
 * The extension's files are classic scripts that attach to a `CanvasMax`
 * global, which means Node can load them directly — no bundler, no jsdom, no
 * mocking of the extension APIs for the pure logic under test.
 */
'use strict';

const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

/** Load the dependency-free library modules in their manifest order. */
function loadLibs() {
  require(path.join(SRC, 'lib', 'util.js'));
  require(path.join(SRC, 'lib', 'storage.js'));
  require(path.join(SRC, 'lib', 'canvas-api.js'));
  require(path.join(SRC, 'lib', 'themes.js'));
  require(path.join(SRC, 'lib', 'grades.js'));
  require(path.join(SRC, 'lib', 'gpa.js'));
  return globalThis.CanvasMax;
}

/**
 * Load a content-script feature. Features touch `document` only inside their
 * callbacks, so a couple of stubs are enough to import them.
 */
function loadFeature(relativePath) {
  globalThis.CanvasMax = globalThis.CanvasMax || {};
  globalThis.CanvasMax.features = globalThis.CanvasMax.features || [];
  if (!globalThis.document) {
    globalThis.document = {
      querySelector: () => null,
      querySelectorAll: () => [],
      readyState: 'complete',
      addEventListener() {},
      createElement: () => ({ style: {}, classList: { add() {}, toggle() {}, remove() {} }, append() {} }),
    };
  }
  if (!globalThis.window) globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
  if (!globalThis.location) globalThis.location = { pathname: '/', search: '', origin: 'https://example.instructure.com' };
  require(path.join(SRC, relativePath));
  return globalThis.CanvasMax;
}

/**
 * Build an assignment-groups payload shaped like Canvas's response.
 * @param {Array<{name:string, weight?:number, assignments:Array}>} spec
 */
function makeGroups(spec) {
  return spec.map((group, index) => ({
    id: String(index + 1),
    name: group.name,
    group_weight: group.weight ?? 0,
    assignments: (group.assignments || []).map((assignment, i) => ({
      id: assignment.id ?? `${index + 1}-${i + 1}`,
      name: assignment.name ?? `Assignment ${i + 1}`,
      points_possible: assignment.possible,
      omit_from_final_grade: assignment.omit ?? false,
      submission_types: assignment.types ?? ['online_upload'],
      submission: assignment.score === undefined && !assignment.excused
        ? null
        : {
          score: assignment.score ?? null,
          workflow_state: assignment.score == null ? 'unsubmitted' : 'graded',
          excused: assignment.excused ?? false,
        },
    })),
  }));
}

module.exports = { loadLibs, loadFeature, makeGroups, SRC };
