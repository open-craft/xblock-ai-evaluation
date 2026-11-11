import { RemainingUploadsByPane } from "../shared/attachments";
import { postJson } from "../shared/request";

interface ShortAnswerResponse {
  response?: string;
  [key: string]: unknown;
}

type ResetResponse = {
  remaining: RemainingUploadsByPane;
};

export async function sendAnswer(url: string, userInput: string, uploadIds: string[]) {
  const response = await postJson<ShortAnswerResponse>(url, { user_input: userInput, upload_ids: uploadIds });
  return response.response || "";
}

export async function resetChat(url: string) {
  return postJson<ResetResponse>(url, {});
}
