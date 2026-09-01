/**
 * CanvasMax — course grade math.
 *
 * Mirrors how Canvas itself computes grades so the numbers CanvasMax shows
 * match the ones on the Grades page:
 *
 *   current grade  ignores anything not yet graded
 *   final grade    treats ungraded work as a zero
 *
 * Weighted courses score each assignment group independently and combine the
 * group percentages by weight. Crucially, when a weighted group has no graded
 * work yet, Canvas drops it and renormalises the remaining weights rather than
 * counting it as zero — otherwise every student would show ~4% in week one.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});

  /** Canvas's out-of-the-box grading standard. */
  const DEFAULT_GRADING_SCHEME = Object.freeze([
    ['A', 94], ['A-', 90],
    ['B+', 87], ['B', 84], ['B-', 80],
    ['C+', 77], ['C', 74], ['C-', 70],
    ['D+', 67], ['D', 64], ['D-', 61],
    ['F', 0],
  ]);

  /**
   * Convert a percentage to a letter using a scheme of [letter, minPercent]
   * pairs, highest cutoff first.
   */
  function letterForPercent(percent, scheme = DEFAULT_GRADING_SCHEME) {
    if (percent == null || Number.isNaN(percent)) return null;
    const sorted = [...scheme].sort((a, b) => b[1] - a[1]);
    for (const [letter, min] of sorted) {
      // Canvas rounds to two places before comparing against the cutoff.
      if (Math.round(percent * 100) / 100 >= min) return letter;
    }
    return sorted.length ? sorted[sorted.length - 1][0] : null;
  }

  /**
   * Canvas returns grading standards as [{ name, value }] where value is a
   * 0..1 fraction. Normalise to our [letter, minPercent] form.
   */
  function normalizeScheme(raw) {
    if (!Array.isArray(raw) || !raw.length) return DEFAULT_GRADING_SCHEME;
    const scheme = raw
      .map((entry) => {
        if (Array.isArray(entry)) return [String(entry[0]), Number(entry[1]) * 100];
        if (entry && typeof entry === 'object') return [String(entry.name), Number(entry.value) * 100];
        return null;
      })
      .filter((entry) => entry && entry[0] && Number.isFinite(entry[1]));
    return scheme.length ? scheme : DEFAULT_GRADING_SCHEME;
  }

  // ------------------------------------------------------ submission view ---

  /** Should this assignment count toward the course grade at all? */
  function isCountable(assignment) {
    if (!assignment) return false;
    if (assignment.omit_from_final_grade) return false;
    // "not_graded" assignments carry no points by definition.
    if (Array.isArray(assignment.submission_types)
      && assignment.submission_types.includes('not_graded')) return false;
    const possible = Number(assignment.points_possible);
    return Number.isFinite(possible);
  }

  /**
   * Resolve the score for one assignment.
   * @returns {{counted:boolean, earned:number, possible:number, graded:boolean}}
   */
  function scoreFor(assignment, { overrides = {}, treatUngradedAsZero = false } = {}) {
    const blank = { counted: false, earned: 0, possible: 0, graded: false };
    if (!isCountable(assignment)) return blank;

    const possible = Number(assignment.points_possible) || 0;
    const id = String(assignment.id);
    const submission = assignment.submission || null;

    // A what-if override wins over the real submission.
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      const override = overrides[id];
      if (override === null || override === '') return blank; // explicitly excluded
      const earned = Number(override);
      if (!Number.isFinite(earned)) return blank;
      return { counted: true, earned, possible, graded: true };
    }

    if (submission?.excused) return blank;

    const hasScore = submission && submission.score != null && submission.workflow_state === 'graded';
    if (hasScore) {
      return { counted: true, earned: Number(submission.score), possible, graded: true };
    }

    if (treatUngradedAsZero && possible > 0) {
      return { counted: true, earned: 0, possible, graded: false };
    }
    return blank;
  }

  // ------------------------------------------------------------- grading ---

  /**
   * Compute a course grade from Canvas assignment groups.
   *
   * @param {Array} groups  /api/v1/courses/:id/assignment_groups?include[]=assignments&include[]=submission
   * @param {object} options
   * @param {object} options.overrides       assignmentId -> hypothetical score (null excludes it)
   * @param {boolean} options.treatUngradedAsZero  compute the "final" rather than "current" grade
   * @param {boolean} options.forceUnweighted      ignore group weights even if present
   * @returns {{percent:number|null, earned:number, possible:number, weighted:boolean, groups:Array}}
   */
  function computeCourseGrade(groups, options = {}) {
    const { overrides = {}, treatUngradedAsZero = false, forceUnweighted = false } = options;
    const list = Array.isArray(groups) ? groups : [];

    const breakdown = list.map((group) => {
      let earned = 0;
      let possible = 0;
      let gradedCount = 0;
      const assignments = Array.isArray(group.assignments) ? group.assignments : [];

      for (const assignment of assignments) {
        const result = scoreFor(assignment, { overrides, treatUngradedAsZero });
        if (!result.counted) continue;
        earned += result.earned;
        possible += result.possible;
        if (result.graded) gradedCount += 1;
      }

      return {
        id: String(group.id),
        name: group.name,
        weight: Number(group.group_weight) || 0,
        earned,
        possible,
        gradedCount,
        percent: possible > 0 ? (earned / possible) * 100 : null,
      };
    });

    const totalWeight = breakdown.reduce((sum, g) => sum + g.weight, 0);
    const weighted = !forceUnweighted && totalWeight > 0;

    if (!weighted) {
      const earned = breakdown.reduce((sum, g) => sum + g.earned, 0);
      const possible = breakdown.reduce((sum, g) => sum + g.possible, 0);
      return {
        percent: possible > 0 ? (earned / possible) * 100 : null,
        earned,
        possible,
        weighted: false,
        groups: breakdown,
      };
    }

    // Weighted: drop groups with no scored work and renormalise, matching
    // Canvas's behaviour for the "current" grade.
    const scored = breakdown.filter((g) => g.possible > 0 && g.weight > 0);
    const availableWeight = scored.reduce((sum, g) => sum + g.weight, 0);
    if (availableWeight <= 0) {
      return { percent: null, earned: 0, possible: 0, weighted: true, groups: breakdown };
    }

    const weightedPercent = scored.reduce(
      (sum, g) => sum + (g.earned / g.possible) * g.weight,
      0
    );

    return {
      percent: (weightedPercent / availableWeight) * 100,
      earned: breakdown.reduce((sum, g) => sum + g.earned, 0),
      possible: breakdown.reduce((sum, g) => sum + g.possible, 0),
      weighted: true,
      availableWeight,
      groups: breakdown,
    };
  }

  /**
   * What score does the user need on one assignment to reach `targetPercent`
   * overall? Returns the raw points needed, or null when the assignment can't
   * move the needle.
   */
  function pointsNeededFor(groups, assignmentId, targetPercent, options = {}) {
    const id = String(assignmentId);
    const assignment = findAssignment(groups, id);
    if (!assignment) return null;
    const possible = Number(assignment.points_possible) || 0;
    if (possible <= 0) return null;

    // The grade is monotonic and piecewise-linear in this one score, so two
    // probes define the line and we can solve directly.
    const low = computeCourseGrade(groups, {
      ...options,
      overrides: { ...(options.overrides || {}), [id]: 0 },
    }).percent;
    const high = computeCourseGrade(groups, {
      ...options,
      overrides: { ...(options.overrides || {}), [id]: possible },
    }).percent;

    if (low == null || high == null || high === low) return null;

    const points = ((targetPercent - low) / (high - low)) * possible;
    return {
      points: Math.round(points * 100) / 100,
      possible,
      achievable: points <= possible,
      alreadyThere: points <= 0,
      percentIfZero: low,
      percentIfFull: high,
    };
  }

  function findAssignment(groups, assignmentId) {
    const id = String(assignmentId);
    for (const group of groups || []) {
      for (const assignment of group.assignments || []) {
        if (String(assignment.id) === id) return assignment;
      }
    }
    return null;
  }

  /** Flatten groups into a single assignment list, tagged with its group. */
  function flattenAssignments(groups) {
    const out = [];
    for (const group of groups || []) {
      for (const assignment of group.assignments || []) {
        out.push({ ...assignment, groupId: String(group.id), groupName: group.name });
      }
    }
    return out;
  }

  /**
   * Best available percentage for a course from the cheap list endpoints,
   * preferring the current grading period when Canvas reports one.
   */
  function percentFromCourse(course) {
    if (!course) return null;
    const enrollment = Array.isArray(course.enrollments)
      ? course.enrollments.find((e) => e.type === 'student' || e.type === 'StudentEnrollment')
        || course.enrollments[0]
      : null;
    if (!enrollment) return null;
    const candidates = [
      enrollment.current_period_computed_current_score,
      enrollment.computed_current_score,
      enrollment.current_score,
    ];
    for (const value of candidates) {
      if (value != null && Number.isFinite(Number(value))) return Number(value);
    }
    return null;
  }

  function letterFromCourse(course, scheme) {
    const enrollment = Array.isArray(course?.enrollments) ? course.enrollments[0] : null;
    const reported = enrollment?.current_period_computed_current_grade
      || enrollment?.computed_current_grade
      || enrollment?.current_grade;
    if (reported) return reported;
    const percent = percentFromCourse(course);
    return percent == null ? null : letterForPercent(percent, scheme);
  }

  function formatPercent(percent, digits = 2) {
    if (percent == null || Number.isNaN(percent)) return null;
    return `${(Math.round(percent * 10 ** digits) / 10 ** digits).toFixed(digits).replace(/\.?0+$/, '')}%`;
  }

  CanvasMax.grades = {
    DEFAULT_GRADING_SCHEME,
    letterForPercent,
    normalizeScheme,
    isCountable,
    scoreFor,
    computeCourseGrade,
    pointsNeededFor,
    findAssignment,
    flattenAssignments,
    percentFromCourse,
    letterFromCourse,
    formatPercent,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
