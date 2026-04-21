import {
  COACHING_STUDIO_SECTIONS,
  CoachingStudioSectionId,
} from "./coachingStudioSections";

export type CoachingStudioValidationErrors = Record<string, string[]>;

export function getSectionErrorCount(
  sectionId: CoachingStudioSectionId,
  validationErrors: CoachingStudioValidationErrors,
) {
  const section = COACHING_STUDIO_SECTIONS.find((entry) => entry.id === sectionId);
  if (!section) {
    return 0;
  }

  return section.fieldNames.reduce((count, fieldName) => {
    return count + (validationErrors[fieldName]?.length || 0);
  }, 0);
}

export function getFirstSectionWithErrors(
  validationErrors: CoachingStudioValidationErrors,
  preferredSectionId?: CoachingStudioSectionId,
): CoachingStudioSectionId | null {
  if (preferredSectionId) {
    const preferredErrorCount = getSectionErrorCount(preferredSectionId, validationErrors);
    if (preferredErrorCount > 0) {
      return preferredSectionId;
    }
  }

  const matchingSection = COACHING_STUDIO_SECTIONS.find((section) => {
    return section.fieldNames.some((fieldName) => {
      return Boolean(validationErrors[fieldName]?.length);
    });
  });

  return matchingSection ? matchingSection.id : null;
}
