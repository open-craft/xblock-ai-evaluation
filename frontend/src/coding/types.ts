import { SharedPayload, UnknownRecord } from "../shared/types";

export interface CodingStudentHandlerUrls extends UnknownRecord {
  get_response?: string;
  get_submission_result_handler?: string;
  reset_handler?: string;
  submit_code_handler?: string;
}

export interface CodingExecutionResult extends UnknownRecord {
  stderr?: string;
  stdout?: string;
}

export interface CodingStudentInitialState extends UnknownRecord {
  ai_evaluation?: unknown;
  code?: string;
  code_exec_result?: CodingExecutionResult;
}

export interface CodingStudentMeta extends UnknownRecord {
  language?: string;
  marked_html?: string;
  monaco_html?: string;
  question?: string;
}

export type CodingStudentPayload = SharedPayload<
  CodingStudentHandlerUrls,
  CodingStudentInitialState,
  CodingStudentMeta
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

export interface CodingStudioLockMetadata extends UnknownRecord {
  initial_model?: string;
  lock_judge0_api_key?: boolean;
  lock_model_api_key_initial?: boolean;
  model_key_presence?: Record<string, boolean>;
  use_custom_llm_service?: boolean;
}

export interface CodingStudioState extends UnknownRecord {
  display_name?: string;
  evaluation_prompt?: string;
  judge0_api_key?: string;
  language?: string;
  model?: string;
  model_api_key?: string;
  model_api_url?: string;
  question?: string;
}

export interface CodingStudioHandlerUrls extends UnknownRecord {
  studio_submit?: string;
}

export interface CodingStudioMeta extends UnknownRecord {
  field_metadata?: Record<string, StudioFieldMetadata>;
  lock_metadata?: CodingStudioLockMetadata;
}

export type CodingStudioPayload = SharedPayload<
  CodingStudioHandlerUrls,
  CodingStudioState,
  CodingStudioMeta
>;
