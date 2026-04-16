import { SharedPayload, StudioFieldMetadata } from "../shared/types";

export interface CoachingCharacter {
  avatar: string;
  name: string;
  pane: string;
  role: string;
}

export interface CoachingMessage {
  character: CoachingCharacter;
  content: string;
  is_user: boolean;
  pane: string;
}

export interface CoachingAttemptState {
  attempts_remaining: number | null;
  attempts_used: number;
  can_retry: boolean;
  max_attempts: number;
}

export interface CoachingFinalReport {
  attempts: CoachingAttemptState;
  evaluation_markdown: string;
  final_submission: string;
  finished: boolean;
  report_html: string;
  show_report_card: boolean;
}

export interface CoachingStudentHandlerUrls {
  get_character_response: string;
  get_evaluator_response: string;
  reset_all: string;
}

export interface CoachingStudentInitialState {
  attempts?: CoachingAttemptState;
  chat_histories?: CoachingMessage[][];
  final_report?: CoachingFinalReport;
  finished?: boolean;
}

export interface CoachingStudentMeta {
  allow_reset?: boolean;
  characters?: CoachingCharacter[];
  coach_initial_message?: CoachingMessage;
  initial_message?: CoachingMessage;
  intro_text?: string;
  titles?: {
    coach?: string;
    workspace?: string;
  };
}

export type CoachingStudentPayload = SharedPayload<
  CoachingStudentHandlerUrls,
  CoachingStudentInitialState,
  CoachingStudentMeta
>;

export interface CoachingStudioLockMetadata {
  initial_model?: string;
  lock_model_api_key_initial?: boolean;
  model_key_presence?: Record<string, boolean>;
  use_custom_llm_service?: boolean;
}

export interface EvaluationCriterion {
  name: string;
}

export interface ScenarioData {
  case_details: string;
  evaluation_criteria: EvaluationCriterion[];
  learning_objectives: string[];
}

export interface CoachingStudioState {
  allow_reset: boolean;
  blacklist: string[];
  character_1_avatar: string;
  character_1_name: string;
  character_1_prompt: string;
  character_1_role: string;
  character_2_avatar: string;
  character_2_name: string;
  character_2_prompt: string;
  character_2_role: string;
  coach_initial_message: string;
  coach_title: string;
  display_name: string;
  evaluator_prompt: string;
  initial_message: string;
  intro_text: string;
  max_attempts: number | string | null;
  model: string;
  model_api_key: string;
  model_api_url: string;
  scenario_data: ScenarioData;
  workspace_title: string;
}

export interface CoachingStudioHandlerUrls {
  studio_submit: string;
}

export interface CoachingStudioMeta {
  field_metadata?: Record<string, StudioFieldMetadata>;
  lock_metadata?: CoachingStudioLockMetadata;
}

export type CoachingStudioPayload = SharedPayload<
  CoachingStudioHandlerUrls,
  Partial<CoachingStudioState>,
  CoachingStudioMeta
>;
