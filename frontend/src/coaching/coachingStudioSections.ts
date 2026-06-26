export type CoachingStudioSectionId =
  | "general"
  | "taskDescription"
  | "taskContext"
  | "evaluation"
  | "workspace"
  | "coachChat"
  | "advanced";

export interface CoachingStudioSection {
  description: string;
  fieldNames: string[];
  id: CoachingStudioSectionId;
  title: string;
}

export const COACHING_STUDIO_SECTIONS: CoachingStudioSection[] = [
  {
    id: "general",
    title: "General",
    description: "",
    fieldNames: ["display_name", "model", "model_api_key", "model_api_url", "max_attempts", "allow_reset"],
  },
  {
    id: "taskDescription",
    title: "Task Description",
    description: "Instructions shown to the learner. HTML is allowed here.",
    fieldNames: ["intro_text"],
  },
  {
    id: "taskContext",
    title: "Task Context for AI",
    description: "",
    fieldNames: ["scenario_data", "scenario_case_details", "scenario_learning_objectives"],
  },
  {
    id: "evaluation",
    title: "Evaluation",
    description: "",
    fieldNames: ["scenario_evaluation_criteria", "evaluator_prompt", "evaluator_attachment_urls"],
  },
  {
    id: "workspace",
    title: "Workspace",
    description: "",
    fieldNames: [
      "workspace_title",
      "character_1_name",
      "character_1_role",
      "initial_message",
      "character_1_prompt",
      "character_1_avatar",
      "workspace_attachment_urls",
    ],
  },
  {
    id: "coachChat",
    title: "Coach Chat",
    description: "",
    fieldNames: [
      "coach_title",
      "character_2_name",
      "character_2_role",
      "coach_initial_message",
      "character_2_prompt",
      "character_2_avatar",
      "coach_attachment_urls",
    ],
  },
  {
    id: "advanced",
    title: "Advanced",
    description: "",
    fieldNames: ["blacklist"],
  },
];
