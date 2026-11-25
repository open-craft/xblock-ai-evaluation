import { MessageAttachment, UploadPane } from "./attachments";
import { postJson, putFile } from "./request";

export interface UploadFileResponse extends MessageAttachment {
  remaining: number;
}

type DeleteUploadResponse = {
  remaining: number;
};

export async function uploadLearnerFile(url: string, pane: UploadPane, file: File) {
  // The filename goes in a header, not the query string, so it stays out of request and tracking logs. Headers must
  // be ASCII, so it's percent-encoded.
  return putFile<UploadFileResponse>(url, file, { pane }, { "X-Upload-Filename": encodeURIComponent(file.name) });
}

export async function deleteLearnerUpload(url: string, pane: UploadPane, uploadId: string) {
  return postJson<DeleteUploadResponse>(url, { pane, upload_id: uploadId });
}
