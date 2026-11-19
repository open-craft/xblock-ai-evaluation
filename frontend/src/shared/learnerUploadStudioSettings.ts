import * as Yup from "yup";

import { isIntegerBetween } from "./studio";

/** The learner upload settings the Studio editors get in their payload's meta. */
export interface LearnerUploadStudioMeta {
  /** Whether the operator turned learner uploads on site-wide. The upload fields are hidden while it's off. */
  learner_uploads_enabled: boolean;
  /** The operator's cap on every Max File Uploads field. */
  max_file_uploads_ceiling: number;
}

/**
 * The schema of a Max File Uploads field. Like the server, it requires a whole number from 1 to the ceiling, but only
 * while the field is shown: learner uploads are on site-wide and the field's File Upload toggle is on.
 * Validate with the payload's meta as the Yup context.
 */
export function maxFileUploadsSchema(allowUploadsFieldName: string) {
  return Yup.mixed().test("max-file-uploads-in-range", function validateMaxFileUploads(value) {
    const { learner_uploads_enabled, max_file_uploads_ceiling } = this.options.context as LearnerUploadStudioMeta;
    if (!learner_uploads_enabled || !this.parent[allowUploadsFieldName]) {
      return true;
    }
    if (isIntegerBetween(value, 1, max_file_uploads_ceiling)) {
      return true;
    }
    return this.createError({
      message: `Max File Uploads must be an integer between 1 and ${max_file_uploads_ceiling}.`,
    });
  });
}
