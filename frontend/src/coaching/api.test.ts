import { postJson } from "../shared/request";
import { sendChatMessage, requestEvaluation, resetAll } from "./api";

jest.mock("../shared/request", () => ({
  ...jest.requireActual("../shared/request"),
  postJson: jest.fn(),
}));

const mockPostJson = postJson as jest.MockedFunction<typeof postJson>;

describe("sendChatMessage", () => {
  afterEach(() => {
    mockPostJson.mockReset();
  });

  it("posts character_index and user_input to the given URL", async () => {
    mockPostJson.mockResolvedValue({ message: { content: "reply" } });

    await sendChatMessage("/handler/get_character_response", 0, "hello");

    expect(mockPostJson).toHaveBeenCalledWith("/handler/get_character_response", {
      character_index: 0,
      user_input: "hello",
    });
  });

  it("returns CharacterResponse", async () => {
    const mockResponse = {
      message: {
        character: { name: "Alex", avatar: "", pane: "workspace", role: "tutor" },
        content: "response text",
        is_user: false,
        pane: "workspace",
      },
      attempts: {
        attempts_remaining: 2,
        attempts_used: 1,
        can_retry: true,
        max_attempts: 3,
      },
      finished: false,
    };
    mockPostJson.mockResolvedValue(mockResponse);

    const result = await sendChatMessage("/handler/get_character_response", 0, "input");
    expect(result).toEqual(mockResponse);
  });
});

describe("requestEvaluation", () => {
  afterEach(() => {
    mockPostJson.mockReset();
  });

  it("posts empty payload to the given URL", async () => {
    mockPostJson.mockResolvedValue({ finished: true });

    await requestEvaluation("/handler/get_evaluator_response");

    expect(mockPostJson).toHaveBeenCalledWith("/handler/get_evaluator_response", {});
  });

  it("returns CharacterResponse with report data", async () => {
    const mockResponse = {
      report_html: "<div>Report</div>",
      evaluation_markdown: "Good job",
      final_submission: "student answer",
      finished: true,
      show_report_card: true,
      attempts: {
        attempts_remaining: 0,
        attempts_used: 3,
        can_retry: false,
        max_attempts: 3,
      },
    };
    mockPostJson.mockResolvedValue(mockResponse);

    const result = await requestEvaluation("/handler/get_evaluator_response");
    expect(result).toEqual(mockResponse);
  });
});

describe("resetAll", () => {
  afterEach(() => {
    mockPostJson.mockReset();
  });

  it("posts empty payload to the given URL", async () => {
    mockPostJson.mockResolvedValue({});

    await resetAll("/handler/reset_all");

    expect(mockPostJson).toHaveBeenCalledWith("/handler/reset_all", {});
  });

  it("returns CharacterResponse with chat_histories", async () => {
    const mockResponse = {
      chat_histories: [[], []],
      attempts: {
        attempts_remaining: 3,
        attempts_used: 0,
        can_retry: true,
        max_attempts: 3,
      },
      finished: false,
    };
    mockPostJson.mockResolvedValue(mockResponse);

    const result = await resetAll("/handler/reset_all");
    expect(result).toEqual(mockResponse);
  });
});
