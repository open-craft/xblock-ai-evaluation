import { SharedPayload, StudioFieldMetadata } from "../shared/types";

export interface ShortAnswerMessage {
  source: string;
  content: string;
}

export interface ShortAnswerStudentHandlerUrls {
  get_response: string;
  reset: string;
  download_pdf: string;
}

export interface ShortAnswerStudentInitialState {
  messages: ShortAnswerMessage[] | null;
}

export interface ShortAnswerStudentMeta {
  allow_reset: boolean;
  character_image: string;
  max_responses: number;
  question: string;
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
  evaluation_prompt: string;
  max_responses: number | string | null;
  model: string;
  model_api_key: string;
  model_api_url: string;
  question: string;
  pdf_download_allowed: boolean;
  pdf_download_title: string;
  pdf_download_description: string;
}

export interface ShortAnswerStudioHandlerUrls {
  studio_submit: string;
}

export interface ShortAnswerStudioMeta {
  field_metadata?: Record<string, StudioFieldMetadata>;
  lock_metadata?: StudioLockMetadata;
}

export type ShortAnswerStudioPayload = SharedPayload<
  ShortAnswerStudioHandlerUrls,
  Partial<ShortAnswerStudioState>,
  ShortAnswerStudioMeta
>;
