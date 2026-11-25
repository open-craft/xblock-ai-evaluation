import React, { useState } from "react";
import userEvent from "@testing-library/user-event";

import { act, fireEvent, render, screen, waitFor } from "../test/helpers";
import * as api from "./api";
import { PaneUploadState, UploadFileLimits } from "./attachments";
import { AttachmentUploader } from "./AttachmentUploader";
import { RequestError } from "./request";
import { useAttachmentUploads } from "./useAttachmentUploads";

jest.mock("./api");

const mockUploadLearnerFile = api.uploadLearnerFile as jest.MockedFunction<typeof api.uploadLearnerFile>;
const mockDeleteLearnerUpload = api.deleteLearnerUpload as jest.MockedFunction<typeof api.deleteLearnerUpload>;

const FILE_LIMITS: UploadFileLimits = {
  pdf_max_bytes: 4194304,
  pdf_max_pages: 10,
  text_max_bytes: 51200,
  accept: ".pdf,.txt,.md,.csv",
};

function TestComposer({ paneState }: { paneState: PaneUploadState }) {
  const uploads = useAttachmentUploads({
    pane: "shortanswer",
    paneState,
    fileLimits: FILE_LIMITS,
    handlerUrls: { upload_file: "/handler/upload_file", delete_upload: "/handler/delete_upload" },
  });
  const [draft, setDraft] = useState("");
  const canSend = !uploads.uploading && (draft.length > 0 || uploads.uploadedAttachments.length > 0);

  return (
    <>
      <AttachmentUploader uploads={uploads} disabled={false}>
        <textarea aria-label="Message" value={draft} onChange={(event) => setDraft(event.target.value)} />
      </AttachmentUploader>
      <button type="button" disabled={!canSend}>Send</button>
    </>
  );
}

function renderComposer(remaining = 3, limit = 3) {
  return render(<TestComposer paneState={{ enabled: true, limit, remaining }} />);
}

function uploadedFile(uploadId: string, filename: string, remaining: number): api.UploadFileResponse {
  return { upload_id: uploadId, filename, content_type: "application/pdf", remaining };
}

function pdf(name: string) {
  return new File(["%PDF-"], name, { type: "application/pdf" });
}

describe("AttachmentUploader", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders only the text input when uploads are disabled", () => {
    render(<TestComposer paneState={{ enabled: false }} />);

    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upload file/i })).not.toBeInTheDocument();
  });

  it("shows remaining in tooltip", async () => {
    const user = userEvent.setup();
    renderComposer(2);

    await user.hover(screen.getByRole("button", { name: "Upload file: 2 remaining" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Upload file: 2 remaining");
  });

  it("disables send while uploading", async () => {
    let finishUpload: (file: api.UploadFileResponse) => void = () => {};
    mockUploadLearnerFile.mockReturnValue(new Promise((resolve) => {
      finishUpload = resolve;
    }));
    const user = userEvent.setup();
    renderComposer();

    await user.type(screen.getByRole("textbox", { name: "Message" }), "my answer");
    await user.upload(screen.getByTestId("attachment-file-input"), pdf("report.pdf"));

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("File")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(mockUploadLearnerFile).toHaveBeenCalledWith("/handler/upload_file", "shortanswer", expect.any(File));

    finishUpload(uploadedFile("upload-1", "report.pdf", 2));

    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload file: 2 remaining" })).toBeInTheDocument();
  });

  it("enables send with files and empty text", async () => {
    mockUploadLearnerFile.mockResolvedValue(uploadedFile("upload-1", "report.pdf", 2));
    const user = userEvent.setup();
    renderComposer();

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    await user.upload(screen.getByTestId("attachment-file-input"), pdf("report.pdf"));

    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
  });

  it("keeps the upload button focusable but inactive while a file uploads, and announces when it finishes", async () => {
    let finishUpload: (file: api.UploadFileResponse) => void = () => {};
    mockUploadLearnerFile.mockReturnValue(new Promise((resolve) => {
      finishUpload = resolve;
    }));
    const user = userEvent.setup();
    renderComposer();
    const uploadButton = screen.getByRole("button", { name: "Upload file: 3 remaining" });

    // In a browser, focus stays on the button that opened the file picker (the input is hidden). user.upload would
    // focus the input, so select the file with a change event instead.
    act(() => uploadButton.focus());
    fireEvent.change(screen.getByTestId("attachment-file-input"), { target: { files: [pdf("report.pdf")] } });

    expect(uploadButton).toBeEnabled();
    expect(uploadButton).toHaveAttribute("aria-disabled", "true");
    expect(uploadButton).toHaveFocus();
    expect(screen.getByTestId("upload-status")).toBeEmptyDOMElement();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    finishUpload(uploadedFile("upload-1", "report.pdf", 2));

    await waitFor(() => expect(screen.getByTestId("upload-status")).toHaveTextContent("report.pdf uploaded"));
    expect(screen.getByRole("button", { name: "Upload file: 2 remaining" })).not.toHaveAttribute("aria-disabled");
  });

  it("clears the limit alert when removing a file frees an upload", async () => {
    mockUploadLearnerFile.mockResolvedValue(uploadedFile("upload-1", "report.pdf", 0));
    mockDeleteLearnerUpload.mockResolvedValue({ remaining: 1 });
    const user = userEvent.setup();
    renderComposer(1, 3);

    await user.upload(screen.getByTestId("attachment-file-input"), pdf("report.pdf"));
    await user.click(await screen.findByRole("button", { name: "Upload file: 0 remaining" }));
    expect(screen.getByRole("alert")).toHaveTextContent("You've reached your file upload limit for this conversation.");

    await user.click(screen.getByRole("button", { name: "Remove report.pdf" }));

    await screen.findByRole("button", { name: "Upload file: 1 remaining" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("removes failed chip and keeps others", async () => {
    mockUploadLearnerFile
      .mockResolvedValueOnce(uploadedFile("upload-1", "good.pdf", 2))
      .mockRejectedValueOnce(new RequestError("Too large", 413, { code: "file_too_large" }));
    const user = userEvent.setup();
    renderComposer();

    await user.upload(screen.getByTestId("attachment-file-input"), [pdf("good.pdf"), pdf("big.pdf")]);

    expect(await screen.findByText(/try a smaller file/i)).toBeInTheDocument();
    expect(screen.getByText("good.pdf")).toBeInTheDocument();
    expect(screen.queryByText("big.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("rejects the whole selection when it has more files than remaining", async () => {
    const user = userEvent.setup();
    renderComposer(1);

    await user.upload(screen.getByTestId("attachment-file-input"), [pdf("a.pdf"), pdf("b.pdf")]);

    expect(screen.getByRole("alert")).toHaveTextContent("Try again with fewer files. 1 of 3 uploads remaining.");
    expect(mockUploadLearnerFile).not.toHaveBeenCalled();
    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
  });

  it("shows the limit alert when the server rejects an upload for the count", async () => {
    mockUploadLearnerFile.mockRejectedValueOnce(
      new RequestError("Limit", 409, { code: "too_many_files", error: "Limit" }),
    );
    const user = userEvent.setup();
    renderComposer(2);

    await user.upload(screen.getByTestId("attachment-file-input"), pdf("report.pdf"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You've reached your file upload limit for this conversation.");
    expect(alert).toHaveClass("alert-info");
    expect(screen.getByRole("button", { name: "Upload file: 0 remaining" })).toBeInTheDocument();
  });

  it("shows the same alert again as a new alert, so screen readers announce it", async () => {
    const user = userEvent.setup();
    renderComposer(0);
    const uploadButton = screen.getByRole("button", { name: "Upload file: 0 remaining" });

    await user.click(uploadButton);
    const firstAlert = screen.getByRole("alert");
    await user.click(uploadButton);

    expect(screen.getByRole("alert")).not.toBe(firstAlert);
  });

  it("moves focus to the upload button after removing a chip", async () => {
    mockUploadLearnerFile.mockResolvedValue(uploadedFile("upload-1", "report.pdf", 2));
    mockDeleteLearnerUpload.mockResolvedValue({ remaining: 3 });
    const user = userEvent.setup();
    renderComposer();

    await user.upload(screen.getByTestId("attachment-file-input"), pdf("report.pdf"));
    await user.click(await screen.findByRole("button", { name: "Remove report.pdf" }));

    expect(screen.getByRole("button", { name: /upload file/i })).toHaveFocus();
  });

  it("delete calls delete_upload and updates remaining", async () => {
    mockUploadLearnerFile.mockResolvedValue(uploadedFile("upload-1", "report.pdf", 2));
    mockDeleteLearnerUpload.mockResolvedValue({ remaining: 3 });
    const user = userEvent.setup();
    renderComposer();

    await user.upload(screen.getByTestId("attachment-file-input"), pdf("report.pdf"));
    await user.click(await screen.findByRole("button", { name: "Remove report.pdf" }));

    expect(mockDeleteLearnerUpload).toHaveBeenCalledWith("/handler/delete_upload", "shortanswer", "upload-1");
    await waitFor(() => expect(screen.queryByText("report.pdf")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Upload file: 3 remaining" })).toBeInTheDocument();
  });

  it("shows info alert at limit", async () => {
    const user = userEvent.setup();
    renderComposer(0);

    await user.click(screen.getByRole("button", { name: "Upload file: 0 remaining" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("You've reached your file upload limit for this conversation.");
    expect(alert).toHaveClass("alert-info");

    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("puts a chip back with an alert when deleting it fails", async () => {
    mockUploadLearnerFile.mockResolvedValue(uploadedFile("upload-1", "report.pdf", 2));
    mockDeleteLearnerUpload.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    renderComposer();

    await user.upload(screen.getByTestId("attachment-file-input"), pdf("report.pdf"));
    await user.click(await screen.findByRole("button", { name: "Remove report.pdf" }));

    expect(await screen.findByText(/please try again later/i)).toBeInTheDocument();
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(mockDeleteLearnerUpload).toHaveBeenCalledTimes(1);
  });

  it("drops a chip without an alert when its upload is already gone", async () => {
    mockUploadLearnerFile.mockResolvedValue(uploadedFile("upload-1", "report.pdf", 2));
    mockDeleteLearnerUpload.mockRejectedValue(
      new RequestError("Invalid upload.", 400, { code: "invalid_upload", error: "Invalid upload." }),
    );
    const user = userEvent.setup();
    renderComposer();

    await user.upload(screen.getByTestId("attachment-file-input"), pdf("report.pdf"));
    await user.click(await screen.findByRole("button", { name: "Remove report.pdf" }));

    await waitFor(() => expect(mockDeleteLearnerUpload).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("report.pdf")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
