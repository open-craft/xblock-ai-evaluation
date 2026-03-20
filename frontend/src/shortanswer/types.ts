import { SharedPayload, UnknownRecord } from "../shared/types";

export interface ShortAnswerMessage {
  source?: string;
  content?: string;
}

export interface ShortAnswerStudentHandlerUrls extends UnknownRecord {
  get_response?: string;
  reset?: string;
}

export interface ShortAnswerStudentInitialState extends UnknownRecord {
  messages?: ShortAnswerMessage[];
}

export interface ShortAnswerStudentMeta extends UnknownRecord {
  allow_reset?: boolean;
  character_image?: string;
  marked_html?: string;
  max_responses?: number;
  question?: string;
}

export type ShortAnswerStudentPayload = SharedPayload<
  ShortAnswerStudentHandlerUrls,
  ShortAnswerStudentInitialState,
  ShortAnswerStudentMeta
>;

export interface StudioChoice {
  display_name?: string;
  value?: string;
}

export interface StudioFieldMetadata {
  choices?: StudioChoice[];
  default?: unknown;
  display_name?: string;
  help?: string;
}

export interface StudioLockMetadata extends UnknownRecord {
  initial_model?: string;
  lock_model_api_key_initial?: boolean;
  model_key_presence?: Record<string, boolean>;
  use_custom_llm_service?: boolean;
}

export interface ShortAnswerStudioState extends UnknownRecord {
  allow_reset?: boolean;
  attachment_urls?: string[];
  character_image?: string;
  display_name?: string;
  evaluation_prompt?: string;
  max_responses?: number | string | null;
  model?: string;
  model_api_key?: string;
  model_api_url?: string;
  question?: string;
}

export interface ShortAnswerStudioHandlerUrls extends UnknownRecord {
  studio_submit?: string;
}

export interface ShortAnswerStudioMeta extends UnknownRecord {
  field_metadata?: Record<string, StudioFieldMetadata>;
  lock_metadata?: StudioLockMetadata;
}

export type ShortAnswerStudioPayload = SharedPayload<
  ShortAnswerStudioHandlerUrls,
  ShortAnswerStudioState,
  ShortAnswerStudioMeta
>;
