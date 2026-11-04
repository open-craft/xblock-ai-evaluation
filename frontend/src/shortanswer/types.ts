import { MessageAttachment, PaneUploadState, UploadFileLimits, UploadHandlerUrls } from "../shared/attachments";
import { LearnerUploadStudioMeta } from "../shared/learnerUploadStudioSettings";
import { SharedPayload, StudioFieldMetadata } from "../shared/types";

export interface ShortAnswerMessage {
  source: string;
  content: string;
  /** The learner's files. Missing on LLM messages and on messages saved before learner uploads. */
  attachments?: MessageAttachment[];
}

export interface ShortAnswerStudentHandlerUrls extends UploadHandlerUrls {
  get_response: string;
  reset: string;
  download_pdf: string;
}

export interface ShortAnswerUploads extends UploadFileLimits {
  shortanswer: PaneUploadState;
}

export interface ShortAnswerStudentInitialState {
  messages: ShortAnswerMessage[] | null;
  uploads: ShortAnswerUploads;
}

export interface ShortAnswerStudentMeta {
  allow_reset: boolean;
  character_image: string;
  character_limit: number;
  max_responses: number;
  title: string;
  // Optional to support previews cached before the background setting was introduced.
  background_theme?: string;
  question: string;
  hide_question: boolean;
  pdf_download_allowed: boolean;
  pdf_download_title: string;
  pdf_download_description: string;
}

export type ShortAnswerStudentPayload = SharedPayload<
  ShortAnswerStudentHandlerUrls,
  ShortAnswerStudentInitialState,
  ShortAnswerStudentMeta
>;

export interface StudioLockMetadata {
  initial_model?: string;
  lock_model_api_key_initial?: boolean;
  model_key_presence?: Record<string, boolean>;
  use_custom_llm_service?: boolean;
}

export interface ShortAnswerStudioState {
  allow_reset: boolean;
  attachment_urls: string[];
  character_image: string;
  display_name: string;
  show_display_name: boolean;
  background_theme: string;
  evaluation_prompt: string;
  max_responses: number | string | null;
  model: string;
  model_api_key: string;
  model_api_url: string;
  question: string;
  hide_question: boolean;
  pdf_download_allowed: boolean;
  pdf_download_title: string;
  pdf_download_description: string;
  allow_learner_uploads: boolean;
  max_file_uploads: number | string | null;
}

export interface ShortAnswerStudioHandlerUrls {
  studio_submit: string;
}

export interface ShortAnswerStudioMeta extends LearnerUploadStudioMeta {
  field_metadata?: Record<string, StudioFieldMetadata>;
  lock_metadata?: StudioLockMetadata;
}

export type ShortAnswerStudioPayload = SharedPayload<
  ShortAnswerStudioHandlerUrls,
  Partial<ShortAnswerStudioState>,
  ShortAnswerStudioMeta
>;
