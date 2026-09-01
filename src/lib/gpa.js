/**
 * CanvasMax — GPA calculation.
 *
 * Supports the three scales students actually ask for:
 *   4.0          the standard US unweighted scale (A and A+ both 4.0)
 *   4.3          A+ is worth 4.3, used by many universities
 *   hs-weighted  4.0 base plus a bump for Honors (+0.5) and AP/IB/DE (+1.0)
 *
 * Percentages are converted to letters with the course's own Canvas grading
 * standard when one is available, so a course whose A starts at 93% is scored
 * as that course defines it rather than as we assume.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const gradesLib = CanvasMax.grades;

  const POINTS_4_0 = Object.freeze({
    'A+': 4.0, A: 4.0, 'A-': 3.7,
    'B+': 3.3, B: 3.0, 'B-': 2.7,
    'C+': 2.3, C: 2.0, 'C-': 1.7,
    'D+': 1.3, D: 1.0, 'D-': 0.7,
    F: 0.0,
  });

  const POINTS_4_3 = Object.freeze({ ...POINTS_4_0, 'A+': 4.3 });

  /** Extra grade points by course rigor, for the weighted high-school scale. */
  const RIGOR_BONUS = Object.freeze({
    regular: 0,
    honors: 0.5,
    ap: 1.0,
    ib: 1.0,
    'dual-enrollment': 1.0,
  });

  const SCALES = Object.freeze({
    '4.0': { label: '4.0 unweighted', max: 4.0, points: POINTS_4_0, weighted: false },
    '4.3': { label: '4.3 (A+ = 4.3)', max: 4.3, points: POINTS_4_3, weighted: false },
    'hs-weighted': { label: 'High school weighted', max: 5.0, points: POINTS_4_0, weighted: true },
  });

  /** Normalise "a-", "A −", "94" etc. into a scheme key like "A-". */
  function normalizeLetter(letter) {
    if (letter == null) return null;
    const clean = String(letter).trim().toUpperCase().replace(/[‐-―−]/g, '-');
    const match = /^([A-F])\s*([+-])?/.exec(clean);
    if (!match) return null;
    const base = match[1];
    const modifier = match[2] || '';
    if (base === 'F') return 'F'; // F+ / F- are not a thing
    return `${base}${modifier}`;
  }

  /**
   * Grade points for one course.
   * @param {object} course
   * @param {string} [course.letter]   letter grade as Canvas reports it
   * @param {number} [course.percent]  percentage, used when no letter exists
   * @param {Array}  [course.scheme]   the course's grading standard
   * @param {string} [course.rigor]    regular | honors | ap | ib | dual-enrollment
   */
  function gradePointsFor(course, scaleKey = '4.0') {
    const scale = SCALES[scaleKey] || SCALES['4.0'];
    let letter = normalizeLetter(course.letter);

    if (!letter && course.percent != null) {
      letter = normalizeLetter(
        gradesLib.letterForPercent(course.percent, course.scheme || gradesLib.DEFAULT_GRADING_SCHEME)
      );
    }
    if (!letter) return null;

    const base = scale.points[letter];
    if (base == null) return null;

    if (!scale.weighted) return base;

    // A failing grade earns no rigor bonus — you don't get extra credit for
    // failing an AP class.
    const bonus = base > 0 ? (RIGOR_BONUS[course.rigor] ?? 0) : 0;
    return base + bonus;
  }

  /**
   * Compute a GPA.
   *
   * @param {Array<object>} courses  each { id, name, letter?, percent?, credits?, rigor?, scheme?, include? }
   * @param {object} options
   * @param {string} options.scale   one of SCALES
   * @returns {{gpa:number|null, totalCredits:number, totalPoints:number, counted:Array, skipped:Array, scale:object}}
   */
  function computeGPA(courses, options = {}) {
    const scaleKey = options.scale && SCALES[options.scale] ? options.scale : '4.0';
    const scale = SCALES[scaleKey];

    const counted = [];
    const skipped = [];
    let totalPoints = 0;
    let totalCredits = 0;

    for (const course of courses || []) {
      if (course.include === false) {
        skipped.push({ ...course, reason: 'excluded' });
        continue;
      }
      const points = gradePointsFor(course, scaleKey);
      if (points == null) {
        skipped.push({ ...course, reason: 'no grade yet' });
        continue;
      }
      const credits = Number(course.credits);
      const weight = Number.isFinite(credits) && credits > 0 ? credits : 1;

      totalPoints += points * weight;
      totalCredits += weight;
      counted.push({ ...course, credits: weight, gradePoints: points });
    }

    return {
      gpa: totalCredits > 0 ? totalPoints / totalCredits : null,
      totalCredits,
      totalPoints,
      counted,
      skipped,
      scale,
      scaleKey,
    };
  }

  /**
   * Given a current GPA and credits, what term GPA is needed across
   * `plannedCredits` to reach `targetGpa`?
   */
  function gpaNeededForTarget({ currentGpa, currentCredits, plannedCredits, targetGpa }) {
    if (!plannedCredits || plannedCredits <= 0) return null;
    const have = (Number(currentGpa) || 0) * (Number(currentCredits) || 0);
    const needTotal = targetGpa * ((Number(currentCredits) || 0) + plannedCredits);
    return (needTotal - have) / plannedCredits;
  }

  function formatGpa(value, digits = 2) {
    if (value == null || Number.isNaN(value)) return null;
    return value.toFixed(digits);
  }

  CanvasMax.gpa = {
    SCALES,
    RIGOR_BONUS,
    POINTS_4_0,
    POINTS_4_3,
    normalizeLetter,
    gradePointsFor,
    computeGPA,
    gpaNeededForTarget,
    formatGpa,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
