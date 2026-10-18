import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

// These tests render the REAL Dashboard and LearningPage with the real router.
// Only the outside world is replaced: auth, network (fetch), toasts, i18n and
// a few heavy presentational children that are irrelevant to this flow.

const toastMock = vi.hoisted(() => {
  const fn = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  fn.loading = vi.fn();
  fn.dismiss = vi.fn();
  return fn;
});
vi.mock("react-hot-toast", () => ({ default: toastMock, toast: toastMock }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: "en" } }),
}));

vi.mock("react-helmet-async", () => ({ Helmet: () => null }));

const authState = vi.hoisted(() => ({
  user: { id: 1, name: "Test", purchasedCourses: [{ courseId: 7, progress: {} }] },
}));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: authState.user,
    fetchUserProfile: vi.fn(),
    updateUser: vi.fn(),
  }),
}));

vi.mock("../components/Preferences", () => ({ default: () => null }));
vi.mock("../components/common/FloatingAssistant", () => ({ default: () => null }));
vi.mock("../components/DashboardHero", () => ({ default: () => null }));
vi.mock("../components/UpcomingLiveSession", () => ({ default: () => null }));
// LearningPage only starts generation once its <video> element exists, so the
// stand-in must render a real <video> and attach the ref it is given.
vi.mock("../components/video/VideoPlayer", () => ({
  default: ({ videoRef }) => <video ref={videoRef} data-testid="video" />,
}));
vi.mock("../components/video/AITranscript", () => ({ default: () => null }));

import Dashboard from "../pages/Dashboard";
import LearningPage from "../pages/LearningPage";

const LESSON = { id: 101, title: "Intro", duration: "5:00", type: "video" };
const LEARNING_DATA = {
  modules: [{ id: 1, title: "Module 1", lessons: [LESSON] }],
  course: { id: 7, title: "React Basics", subtitle: "Web", progress: 0 },
  currentLesson: { ...LESSON, module: "Module 1" },
};

const json = (body, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

// Records the location so tests can assert on the real navigation result.
let currentLocation;
const LocationSpy = () => {
  currentLocation = useLocation();
  return null;
};

let generateResponse;
let coursesResponse;
let statsResponse;
let myCoursesResponse;
let fetchMock;

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <LocationSpy />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/courses" element={<div>Courses page</div>} />
        <Route path="/learning/:id" element={<LearningPage />} />
      </Routes>
    </MemoryRouter>
  );

const clickBanner = async () => {
  const button = await screen.findByRole("button", { name: /generate ai lesson/i });
  fireEvent.click(button);
};

const generateCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/ai/generate-video"));

beforeEach(() => {
  localStorage.setItem("token", "test-token");
  toastMock.error.mockClear();
  authState.user = {
    id: 1,
    name: "Test",
    purchasedCourses: [{ courseId: 7, progress: {} }],
  };
  generateResponse = () => json({ message: "AI service unavailable" }, 500);
  coursesResponse = () =>
    json([{ id: 7, title: "React Basics", lessonsCount: 10, lessons: "10 lessons" }]);
  // Real backend shape of GET /api/courses/stats/cards (no `statsCards` key).
  statsResponse = () =>
    json({ totalCourses: 1, completedCourses: 0, hoursLearned: 0, certificates: 0 });
  myCoursesResponse = () => json([{ id: 7 }]);

  fetchMock = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/api/courses")) return coursesResponse();
    if (u.includes("/api/courses/stats/cards")) return statsResponse();
    if (u.includes("/api/courses/my-courses")) return myCoursesResponse();
    if (u.includes("/api/certificate/list")) return json({ stats: {} });
    if (u.includes("/api/courses/7/learning")) return json(structuredClone(LEARNING_DATA));
    if (u.includes("/api/ai/generate-video")) return generateResponse();
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Dashboard banner when courses are missing (the 'No courses available' bug)", () => {
  it("still shows courses when the stats request fails, and tells the user to enroll", async () => {
    authState.user = { id: 1, name: "Test", purchasedCourses: [] };
    myCoursesResponse = () => json([]);
    statsResponse = () => json({ message: "Failed to load stats" }, 500);

    renderApp();
    // Courses come from /api/courses and must not be blanked by the stats failure.
    expect((await screen.findAllByText("React Basics")).length).toBeGreaterThan(0);

    await clickBanner();

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith("Enroll in a course to try AI lessons."));
    await waitFor(() => expect(currentLocation.pathname).toBe("/courses"));
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("says it could not LOAD courses (not 'none available') when /api/courses fails", async () => {
    authState.user = { id: 1, name: "Test", purchasedCourses: [] };
    myCoursesResponse = () => json([]);
    coursesResponse = () => json({ message: "Failed to load courses" }, 500);

    renderApp();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/api/courses"))).toBe(true)
    );
    // Let the failed load settle before clicking.
    await new Promise((r) => setTimeout(r, 50));
    await clickBanner();

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't load courses. Please try again.")
    );
    expect(toastMock.error).not.toHaveBeenCalledWith(
      "No courses are available right now. Check back soon!"
    );
  });

  it("says no courses are available only when the API genuinely returns none", async () => {
    authState.user = { id: 1, name: "Test", purchasedCourses: [] };
    myCoursesResponse = () => json([]);
    coursesResponse = () => json([]);

    renderApp();
    await new Promise((r) => setTimeout(r, 50));
    await clickBanner();

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "No courses are available right now. Check back soon!"
      )
    );
  });
});

describe("Dashboard banner -> AI lesson picker (real components)", () => {
  it("clicking the banner navigates to the course and opens the celebrity picker", async () => {
    renderApp();
    await clickBanner();

    // Real router navigation to the enrolled course's learning page.
    await waitFor(() => expect(currentLocation.pathname).toBe("/learning/7"));

    // The picker (existing modal) opens without any further user action.
    expect(await screen.findByText("Salman Khan")).toBeDefined();
    expect(screen.getByText("Modi ji")).toBeDefined();
    expect(screen.getByText("SRK")).toBeDefined();

    // Opening the picker must not start generation by itself.
    expect(generateCalls()).toHaveLength(0);
  });

  it("clears the navigation flag so the picker does not reopen on refresh/re-entry", async () => {
    renderApp();
    await clickBanner();
    await screen.findByText("Salman Khan");

    await waitFor(() => expect(currentLocation.state?.openAIVoiceover).toBeUndefined());
  });

  it("does not open the picker on normal navigation to the learning page", async () => {
    render(
      <MemoryRouter initialEntries={["/learning/7"]}>
        <Routes>
          <Route path="/learning/:id" element={<LearningPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/courses/7/learning"))).toBe(true)
    );
    expect(screen.queryByText("Salman Khan")).toBeNull();
  });

  it("choosing a celebrity sends exactly one generate-video request with the right payload", async () => {
    generateResponse = () =>
      json({ cached: true, videoUrl: "https://res.cloudinary.com/demo/video.mp4", jobId: "j1" });

    renderApp();
    await clickBanner();
    fireEvent.click(await screen.findByText("Salman Khan"));

    await waitFor(() => expect(generateCalls()).toHaveLength(1));
    const [url, options] = generateCalls()[0];
    expect(url).toBe("/api/ai/generate-video");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer test-token");
    expect(JSON.parse(options.body)).toEqual({
      courseId: 7,
      lessonId: 101,
      celebrity: "salman",
    });
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("shows the server's message when generate-video fails", async () => {
    generateResponse = () => json({ message: "Course not purchased" }, 403);

    renderApp();
    await clickBanner();
    fireEvent.click(await screen.findByText("Salman Khan"));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Course not purchased", {
        id: "ai-video-error",
      })
    );
  });

  it("shows a friendly fallback when the request cannot reach the server", async () => {
    generateResponse = () => Promise.reject(new TypeError("Failed to fetch"));

    renderApp();
    await clickBanner();
    fireEvent.click(await screen.findByText("Salman Khan"));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Couldn't generate the AI lesson. Please try again.",
        { id: "ai-video-error" }
      )
    );
  });
});