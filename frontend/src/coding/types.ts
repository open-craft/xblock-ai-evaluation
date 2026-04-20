import { SharedPayload, StudioFieldMetadata } from "../shared/types";

export interface CodingStudentHandlerUrls {
  get_response: string;
  get_submission_result_handler: string;
  reset_handler: string;
  submit_code_handler: string;
  download_pdf: string;
}

export interface CodingExecutionResult {
  stderr: string;
  stdout: string;
}

export interface CodingStudentInitialState {
  ai_evaluation: string;
  code: string;
  code_exec_result: CodingExecutionResult | null;
}

export interface CodingStudentMeta {
  language: string;
  monaco_html: string;
  question: string;
  pdf_download_allowed: boolean;
  pdf_download_title: string;
  pdf_download_description: string;
}

export type CodingStudentPayload = SharedPayload<
  CodingStudentHandlerUrls,
  CodingStudentInitialState,
  CodingStudentMeta
>;

export interface CodingStudioLockMetadata {
  initial_model?: string;
  lock_judge0_api_key?: boolean;
  lock_model_api_key_initial?: boolean;
  model_key_presence?: Record<string, boolean>;
  use_custom_llm_service?: boolean;
}

export interface CodingStudioState {
  display_name: string;
  evaluation_prompt: string;
  judge0_api_key: string;
  language: string;
  model: string;
  model_api_key: string;
  model_api_url: string;
  question: string;
  pdf_download_allowed: boolean;
  pdf_download_title: string;
  pdf_download_description: string;
}

export interface CodingStudioHandlerUrls {
  studio_submit: string;
}

export interface CodingStudioMeta {
  field_metadata?: Record<string, StudioFieldMetadata>;
  lock_metadata?: CodingStudioLockMetadata;
}

export type CodingStudioPayload = SharedPayload<
  CodingStudioHandlerUrls,
  Partial<CodingStudioState>,
  CodingStudioMeta
>;
