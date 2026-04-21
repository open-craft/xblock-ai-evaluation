import { postJson } from "../shared/request";
import { sendAnswer, resetChat } from "./api";

jest.mock("../shared/request", () => ({
  ...jest.requireActual("../shared/request"),
  postJson: jest.fn(),
}));

const mockPostJson = postJson as jest.MockedFunction<typeof postJson>;

describe("sendAnswer", () => {
  afterEach(() => {
    mockPostJson.mockReset();
  });

  it("posts user_input to the given URL", async () => {
    mockPostJson.mockResolvedValue({ response: "reply" });

    await sendAnswer("/handler/get_response", "my answer");

    expect(mockPostJson).toHaveBeenCalledWith("/handler/get_response", {
      user_input: "my answer",
    });
  });

  it("returns response content string", async () => {
    mockPostJson.mockResolvedValue({ response: "Great answer!" });

    const result = await sendAnswer("/handler/get_response", "input");
    expect(result).toBe("Great answer!");
  });

  it("returns empty string when response is empty", async () => {
    mockPostJson.mockResolvedValue({});

    const result = await sendAnswer("/handler/get_response", "input");
    expect(result).toBe("");
  });
});

describe("resetChat", () => {
  afterEach(() => {
    mockPostJson.mockReset();
  });

  it("posts empty payload to the given URL", async () => {
    mockPostJson.mockResolvedValue({});

    await resetChat("/handler/reset");

    expect(mockPostJson).toHaveBeenCalledWith("/handler/reset", {});
  });
});
