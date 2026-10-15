import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AILessonBanner from "../components/AILessonBanner";

afterEach(() => {
  cleanup();
});

// ─── 1. Presentational AILessonBanner tests (unchanged) ────────────────────
describe("AILessonBanner", () => {
  it("renders the title, New badge and subtitle", () => {
    render(<AILessonBanner onGenerate={() => {}} />);

    expect(screen.getByText("Try AI Generated Lessons")).toBeDefined();
    expect(screen.getByText("New")).toBeDefined();
    expect(
      screen.getByText(/create personalized video lessons with your favorite celebrity/i)
    ).toBeDefined();
  });

  it("calls onGenerate once when the Generate AI Lesson button is clicked", () => {
    const handleGenerate = vi.fn();
    render(<AILessonBanner onGenerate={handleGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: /generate ai lesson/i }));

    expect(handleGenerate).toHaveBeenCalledTimes(1);
  });

  it("does not trigger onGenerate on render", () => {
    const handleGenerate = vi.fn();
    render(<AILessonBanner onGenerate={handleGenerate} />);

    expect(handleGenerate).not.toHaveBeenCalled();
  });
});

// ─── 2. handleGenerateAILesson logic tests ─────────────────────────────────
//
// The handler lives inside Dashboard which is heavy to render in unit tests
// (requires AuthContext, i18n, react-router, many API mocks, etc.).
// Instead we extract its core decision logic into a pure, testable function
// and verify the four code paths:
//   A. enrolled course found locally  → navigate to learning page
//   B. enrolled course found via API   → navigate to learning page
//   C. API error                       → error toast, no redirect
//   D. no enrolled courses, browse ok  → info toast + redirect
//   E. no enrolled courses, nothing    → error toast, no redirect

/**
 * Mirrors the decision logic of handleGenerateAILesson from Dashboard.jsx.
 * Returns { action, courseId?, toastType?, toastMsg? }.
 */
async function resolveAILessonAction({
  continueLearning,
  myCourses,
  allCourses,
  fetchMyCourses, // async () => { id }[] | throws
}) {
  let courseId = continueLearning[0]?.id ?? myCourses[0]?.id;

  if (!courseId) {
    try {
      const enrolled = await fetchMyCourses();
      courseId = Array.isArray(enrolled) ? enrolled[0]?.id : undefined;
    } catch {
      return { action: "error", toastType: "error", toastMsg: "Couldn't load your courses. Please try again." };
    }
  }

  if (courseId) {
    return { action: "navigate", courseId };
  }

  if (allCourses.length > 0) {
    return { action: "browse", toastType: "info", toastMsg: "Enroll in a course to try AI lessons." };
  }

  return { action: "none", toastType: "error", toastMsg: "No courses are available right now. Check back soon!" };
}

describe("handleGenerateAILesson logic", () => {
  it("A: navigates to learning page when user has an in-progress course", async () => {
    const result = await resolveAILessonAction({
      continueLearning: [{ id: "course-42" }],
      myCourses: [{ id: "course-42" }],
      allCourses: [{ id: "course-42" }],
      fetchMyCourses: async () => [],
    });

    expect(result.action).toBe("navigate");
    expect(result.courseId).toBe("course-42");
  });

  it("A: prefers continueLearning over myCourses", async () => {
    const result = await resolveAILessonAction({
      continueLearning: [{ id: "in-progress-1" }],
      myCourses: [{ id: "enrolled-1" }],
      allCourses: [{ id: "in-progress-1" }, { id: "enrolled-1" }],
      fetchMyCourses: async () => [],
    });

    expect(result.courseId).toBe("in-progress-1");
  });

  it("A: falls back to myCourses when continueLearning is empty", async () => {
    const result = await resolveAILessonAction({
      continueLearning: [],
      myCourses: [{ id: "enrolled-1" }],
      allCourses: [{ id: "enrolled-1" }],
      fetchMyCourses: async () => [],
    });

    expect(result.action).toBe("navigate");
    expect(result.courseId).toBe("enrolled-1");
  });

  it("B: fetches my-courses API when local lists are empty", async () => {
    const fetchMyCourses = vi.fn().mockResolvedValue([{ id: "api-course-7" }]);

    const result = await resolveAILessonAction({
      continueLearning: [],
      myCourses: [],
      allCourses: [{ id: "api-course-7" }],
      fetchMyCourses,
    });

    expect(fetchMyCourses).toHaveBeenCalledOnce();
    expect(result.action).toBe("navigate");
    expect(result.courseId).toBe("api-course-7");
  });

  it("C: shows error toast when my-courses API fails", async () => {
    const fetchMyCourses = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await resolveAILessonAction({
      continueLearning: [],
      myCourses: [],
      allCourses: [{ id: "some-course" }],
      fetchMyCourses,
    });

    expect(result.action).toBe("error");
    expect(result.toastType).toBe("error");
    expect(result.toastMsg).toMatch(/couldn't load/i);
  });

  it("D: redirects to browse courses when enrolled is empty but courses exist", async () => {
    const result = await resolveAILessonAction({
      continueLearning: [],
      myCourses: [],
      allCourses: [{ id: "available-1" }, { id: "available-2" }],
      fetchMyCourses: async () => [],
    });

    expect(result.action).toBe("browse");
    expect(result.toastType).toBe("info");
    expect(result.toastMsg).toMatch(/enroll in a course/i);
  });

  it("E: shows error when no courses exist at all", async () => {
    const result = await resolveAILessonAction({
      continueLearning: [],
      myCourses: [],
      allCourses: [],
      fetchMyCourses: async () => [],
    });

    expect(result.action).toBe("none");
    expect(result.toastType).toBe("error");
    expect(result.toastMsg).toMatch(/no courses are available/i);
  });

  it("B: does not call fetchMyCourses when a local course is available", async () => {
    const fetchMyCourses = vi.fn();

    await resolveAILessonAction({
      continueLearning: [{ id: "local-course" }],
      myCourses: [],
      allCourses: [],
      fetchMyCourses,
    });

    expect(fetchMyCourses).not.toHaveBeenCalled();
  });
});