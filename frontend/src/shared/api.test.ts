import { uploadLearnerFile } from "./api";
import { putFile } from "./request";

jest.mock("./request");

const mockPutFile = putFile as jest.MockedFunction<typeof putFile>;

describe("uploadLearnerFile", () => {
  it("sends the filename percent-encoded in a header, not in the query string", async () => {
    const file = new File(["%PDF-"], "Résumé draft.pdf", { type: "application/pdf" });

    await uploadLearnerFile("/handler/upload_file", "workspace", file);

    expect(mockPutFile).toHaveBeenCalledWith(
      "/handler/upload_file", file, { pane: "workspace" }, { "X-Upload-Filename": "R%C3%A9sum%C3%A9%20draft.pdf" },
    );
  });
});
