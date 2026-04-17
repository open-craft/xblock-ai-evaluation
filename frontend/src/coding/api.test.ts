import { postJson } from "../shared/request";
import {
  fetchAiFeedback,
  pollSubmissionResult,
  resetCodingSession,
  submitCode,
  wait,
} from "./api";

jest.mock("../shared/request", () => ({
  ...jest.requireActual("../shared/request"),
  postJson: jest.fn(),
}));

const mockPostJson = postJson as jest.MockedFunction<typeof postJson>;

describe("submitCode", () => {
  afterEach(() => {
    mockPostJson.mockReset();
  });

  it("posts user_code to the given URL", async () => {
    mockPostJson.mockResolvedValue({ submission_id: "abc123" });

    await submitCode("/handler/submit", "print('hello')");

    expect(mockPostJson).toHaveBeenCalledWith("/handler/submit", {
      user_code: "print('hello')",
    });
  });

  it("returns submission response with submission_id", async () => {
    mockPostJson.mockResolvedValue({ submission_id: "abc123" });

    const result = await submitCode("/handler/submit", "code");
    expect(result).toEqual({ submission_id: "abc123" });
  });
});

describe("pollSubmissionResult", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    mockPostJson.mockReset();
  });

  it("returns result when status is not in-queue/processing", async () => {
    mockPostJson.mockResolvedValue({
      status: { id: 3 },
      stdout: "output",
      stderr: "",
    });

    const result = await pollSubmissionResult("/handler/result", "abc123");
    expect(result).toEqual({
      status: { id: 3 },
      stdout: "output",
      stderr: "",
    });
  });

  it("retries when status is 1 (in queue)", async () => {
    mockPostJson
      .mockResolvedValueOnce({ status: { id: 1 } })
      .mockResolvedValueOnce({ status: { id: 3 }, stdout: "done" });

    const promise = pollSubmissionResult("/handler/result", "abc123");
    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    const result = await promise;

    expect(mockPostJson).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: { id: 3 }, stdout: "done" });
  });

  it("retries when status is 2 (processing)", async () => {
    mockPostJson
      .mockResolvedValueOnce({ status: { id: 2 } })
      .mockResolvedValueOnce({ status: { id: 3 }, stdout: "done" });

    const promise = pollSubmissionResult("/handler/result", "abc123");
    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    const result = await promise;

    expect(mockPostJson).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: { id: 3 }, stdout: "done" });
  });

  it("throws after MAX_JUDGE0_RETRY_ITER retries", async () => {
    mockPostJson.mockResolvedValue({ status: { id: 1 } });

    const promise = pollSubmissionResult("/handler/result", "abc123");

    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(1100);
    }

    await expect(promise).rejects.toThrow("Judge0 submission result fetch failed after 5 attempts.");
  }, 15000);

  it("sends submission_id in each poll request", async () => {
    mockPostJson.mockResolvedValue({ status: { id: 3 }, stdout: "" });

    await pollSubmissionResult("/handler/result", "test-id");

    expect(mockPostJson).toHaveBeenCalledWith("/handler/result", {
      submission_id: "test-id",
    });
  });
});

describe("fetchAiFeedback", () => {
  afterEach(() => {
    mockPostJson.mockReset();
  });

  it("posts code, stdout, stderr to the given URL", async () => {
    mockPostJson.mockResolvedValue({ response: "feedback" });

    await fetchAiFeedback("/handler/feedback", "code", "out", "err");

    expect(mockPostJson).toHaveBeenCalledWith("/handler/feedback", {
      code: "code",
      stdout: "out",
      stderr: "err",
    });
  });

  it("returns response content", async () => {
    mockPostJson.mockResolvedValue({ response: "Good work!" });

    const result = await fetchAiFeedback("/handler/feedback", "code", "", "");
    expect(result).toBe("Good work!");
  });

  it("returns empty string when response is empty", async () => {
    mockPostJson.mockResolvedValue({});

    const result = await fetchAiFeedback("/handler/feedback", "code", "", "");
    expect(result).toBe("");
  });
});

describe("resetCodingSession", () => {
  afterEach(() => {
    mockPostJson.mockReset();
  });

  it("posts empty payload to the given URL", async () => {
    mockPostJson.mockResolvedValue({});

    await resetCodingSession("/handler/reset");

    expect(mockPostJson).toHaveBeenCalledWith("/handler/reset", {});
  });
});

describe("wait", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves after specified milliseconds", async () => {
    const promise = wait(1000);
    jest.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
  });
});
