import {
  checkFileSelection,
  supportedFileTypes,
  UPLOAD_ALERT_MESSAGES,
  uploadAlertCodeForError,
  UploadFileLimits,
} from "./attachments";
import { RequestError } from "./request";

const FILE_LIMITS: UploadFileLimits = {
  pdf_max_bytes: 1000,
  pdf_max_pages: 50,
  text_max_bytes: 100,
  accept: ".pdf,.txt,.md,.csv",
};

function fileOfSize(name: string, size: number) {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("checkFileSelection", () => {
  it("accepts a selection within the limits", () => {
    const files = [fileOfSize("report.PDF", 1000), fileOfSize("notes.md", 100)];

    expect(checkFileSelection(files, 2, FILE_LIMITS)).toBeNull();
  });

  it("rejects selection over remaining", () => {
    const files = [fileOfSize("a.txt", 10), fileOfSize("b.txt", 10)];

    expect(checkFileSelection(files, 1, FILE_LIMITS)).toBe("too_many_files");
  });

  it("rejects selection with unsupported type", () => {
    const files = [fileOfSize("a.txt", 10), fileOfSize("essay.docx", 10)];

    expect(checkFileSelection(files, 3, FILE_LIMITS)).toBe("unsupported_type");
    expect(checkFileSelection([fileOfSize("README", 10)], 3, FILE_LIMITS)).toBe("unsupported_type");
  });

  it("rejects oversize by type", () => {
    expect(checkFileSelection([fileOfSize("data.csv", 101)], 3, FILE_LIMITS)).toBe("file_too_large");
    expect(checkFileSelection([fileOfSize("report.pdf", 1001)], 3, FILE_LIMITS)).toBe("file_too_large");
    expect(checkFileSelection([fileOfSize("report.pdf", 500)], 3, FILE_LIMITS)).toBeNull();
  });
});

describe("uploadAlertCodeForError", () => {
  it("maps error codes to messages", () => {
    const tooManyPages = new RequestError("Too many pages", 422, { code: "too_many_pages" });
    const uploadsDisabled = new RequestError("Disabled", 403, { code: "uploads_disabled" });
    const limitReached = new RequestError("Limit", 409, { code: "too_many_files" });
    const proxyTooLarge = new RequestError("Request Entity Too Large", 413, { raw: "<html>413</html>" });

    expect(uploadAlertCodeForError(tooManyPages)).toBe("too_many_pages");
    expect(uploadAlertCodeForError(uploadsDisabled)).toBe("uploads_disabled");
    expect(uploadAlertCodeForError(limitReached)).toBe("limit_reached");
    expect(uploadAlertCodeForError(proxyTooLarge)).toBe("file_too_large");
    expect(uploadAlertCodeForError(new TypeError("Failed to fetch"))).toBe("upload_failed");
    expect(UPLOAD_ALERT_MESSAGES.too_many_pages.defaultMessage).toBe("Try a shorter PDF. Max <b>{pages} pages</b>.");
  });
});

describe("supportedFileTypes", () => {
  it("lists the accepted extensions for display", () => {
    expect(supportedFileTypes(FILE_LIMITS)).toBe("PDF, TXT, MD, CSV");
  });
});
