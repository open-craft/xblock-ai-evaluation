import { MessageAttachment, RemainingUploadsByPane } from "../shared/attachments";
import { postJson } from "../shared/request";
import { CoachingAttemptState, CoachingMessage } from "./types";

export interface CharacterResponse {
  attempts?: CoachingAttemptState;
  chat_histories?: CoachingMessage[][];
  finished?: boolean;
  message?: CoachingMessage;
  report_html?: string;
  evaluation_markdown?: string;
  final_submission?: string;
  final_submission_attachments?: MessageAttachment[];
  show_report_card?: boolean;
  [key: string]: unknown;
}

type ResetAllResponse = {
  attempts: CoachingAttemptState;
  chat_histories: CoachingMessage[][];
  finished: boolean;
  remaining: RemainingUploadsByPane;
};

export async function sendChatMessage(
  url: string,
  characterIndex: number,
  userInput: string,
  uploadIds: string[],
) {
  return postJson<CharacterResponse>(url, {
    character_index: characterIndex,
    user_input: userInput,
    upload_ids: uploadIds,
  });
}

export async function requestEvaluation(url: string) {
  return postJson<CharacterResponse>(url, {});
}

export async function resetAll(url: string) {
  return postJson<ResetAllResponse>(url, {});
}
