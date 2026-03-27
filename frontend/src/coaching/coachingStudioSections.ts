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
    description: "Instructions shown to the learner.",
    fieldNames: ["intro_text"],
  },
  {
    id: "taskContext",
    title: "Task Context for AI",
    description: "Give the AI the task background and objectives it should reference.",
    fieldNames: ["scenario_data", "scenario_case_details", "scenario_learning_objectives"],
  },
  {
    id: "evaluation",
    title: "Evaluation",
    description: "Define the rubric and evaluator behavior used after the conversation ends.",
    fieldNames: ["scenario_evaluation_criteria", "evaluator_prompt"],
  },
  {
    id: "workspace",
    title: "Workspace",
    description: "Configure the primary character and the main learner workspace.",
    fieldNames: [
      "workspace_title",
      "character_1_name",
      "character_1_role",
      "initial_message",
      "character_1_prompt",
      "character_1_avatar",
    ],
  },
  {
    id: "coachChat",
    title: "Coach Chat",
    description: "Configure the coach pane, coach persona, and its opening guidance.",
    fieldNames: [
      "coach_title",
      "character_2_name",
      "character_2_role",
      "coach_initial_message",
      "character_2_prompt",
      "character_2_avatar",
    ],
  },
  {
    id: "advanced",
    title: "Advanced",
    description: "Control blocked words and phrases in AI output.",
    fieldNames: ["blacklist"],
  },
];
