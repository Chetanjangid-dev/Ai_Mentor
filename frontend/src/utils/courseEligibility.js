/**
 * Utilities for course lesson parsing and deterministic AI lesson course selection.
 */

export const parseLessonCount = (course) =>
  Number(course?.total) ||
  Number(course?.lessonsCount) ||
  Number.parseInt(String(course?.lessons || "0"), 10) ||
  0;

/**
 * Deterministically selects the best enrolled course for AI lesson generation.
 * Priority rule:
 * 1. An in-progress course with eligible lessons (0 < completed < total).
 * 2. A not-yet-started course with eligible lessons (completed === 0, total > 0).
 * 3. A completed course with eligible lessons (completed >= total, total > 0).
 * Courses with 0 lessons are ineligible and filtered out.
 */
export const selectEligibleAICourse = (enrolledList = []) => {
  if (!Array.isArray(enrolledList) || enrolledList.length === 0) return null;
  const withLessons = enrolledList.filter((c) => parseLessonCount(c) > 0);
  if (withLessons.length === 0) return null;

  // 1. In-progress courses
  const inProgress = withLessons.filter(
    (c) => c.completed > 0 && c.completed < parseLessonCount(c),
  );
  if (inProgress.length > 0) return inProgress[0];

  // 2. Not-yet-started courses
  const notStarted = withLessons.filter((c) => (c.completed || 0) === 0);
  if (notStarted.length > 0) return notStarted[0];

  // 3. Completed courses
  return withLessons[0];
};
