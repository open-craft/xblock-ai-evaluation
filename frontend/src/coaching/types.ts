import { SharedPayload, StudioFieldMetadata, UnknownRecord } from "../shared/types";

export interface CoachingCharacter extends UnknownRecord {
  avatar?: string;
  name?: string;
  pane?: string;
  role?: string;
}

export interface CoachingMessage extends UnknownRecord {
  character?: CoachingCharacter;
  content?: string;
  is_user?: boolean;
  pane?: string;
}

export interface CoachingAttemptState extends UnknownRecord {
  attempts_remaining?: number | null;
  attempts_used?: number;
  can_retry?: boolean;
  max_attempts?: number;
}

export interface CoachingFinalReport extends UnknownRecord {
  attempts?: CoachingAttemptState;
  evaluation_markdown?: string;
  final_submission?: string;
  finished?: boolean;
  report_html?: string;
  show_report_card?: boolean;
}

export interface CoachingStudentHandlerUrls extends UnknownRecord {
  get_character_response?: string;
  get_evaluator_response?: string;
  reset_all?: string;
}

export interface CoachingStudentInitialState extends UnknownRecord {
  attempts?: CoachingAttemptState;
  chat_histories?: CoachingMessage[][];
  final_report?: CoachingFinalReport;
  finished?: boolean;
}

export interface CoachingStudentMeta extends UnknownRecord {
  allow_reset?: boolean;
  characters?: CoachingCharacter[];
  coach_initial_message?: CoachingMessage;
  initial_message?: CoachingMessage;
  intro_text?: string;
  marked_html?: string;
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

export interface CoachingStudioLockMetadata extends UnknownRecord {
  initial_model?: string;
  lock_model_api_key_initial?: boolean;
  model_key_presence?: Record<string, boolean>;
  use_custom_llm_service?: boolean;
}

export interface CoachingStudioState extends UnknownRecord {
  allow_reset?: boolean;
  blacklist?: string;
  character_1_avatar?: string;
  character_1_name?: string;
  character_1_prompt?: string;
  character_1_role?: string;
  character_2_avatar?: string;
  character_2_name?: string;
  character_2_prompt?: string;
  character_2_role?: string;
  coach_initial_message?: string;
  coach_title?: string;
  display_name?: string;
  evaluator_prompt?: string;
  initial_message?: string;
  intro_text?: string;
  max_attempts?: number | string | null;
  model?: string;
  model_api_key?: string;
  model_api_url?: string;
  scenario_data?: string;
  workspace_title?: string;
}

export interface CoachingStudioHandlerUrls extends UnknownRecord {
  studio_submit?: string;
}

export interface CoachingStudioMeta extends UnknownRecord {
  field_metadata?: Record<string, StudioFieldMetadata>;
  lock_metadata?: CoachingStudioLockMetadata;
}

export type CoachingStudioPayload = SharedPayload<
  CoachingStudioHandlerUrls,
  CoachingStudioState,
  CoachingStudioMeta
>;
