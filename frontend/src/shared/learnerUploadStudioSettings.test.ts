import * as Yup from "yup";

import { LearnerUploadStudioMeta, maxFileUploadsSchema } from "./learnerUploadStudioSettings";

const schema = Yup.object({
  allow_learner_uploads: Yup.boolean(),
  max_file_uploads: maxFileUploadsSchema("allow_learner_uploads"),
});

const UPLOADS_ON_SITE_WIDE: LearnerUploadStudioMeta = { learner_uploads_enabled: true, max_file_uploads_ceiling: 5 };

function validationError(values: Record<string, unknown>, context: LearnerUploadStudioMeta) {
  try {
    schema.validateSync(values, { context });
    return null;
  } catch (error: unknown) {
    return (error as Yup.ValidationError).message;
  }
}

describe("maxFileUploadsSchema", () => {
  it("accepts a whole number from 1 to the ceiling", () => {
    expect(validationError({ allow_learner_uploads: true, max_file_uploads: 1 }, UPLOADS_ON_SITE_WIDE)).toBeNull();
    expect(validationError({ allow_learner_uploads: true, max_file_uploads: "5" }, UPLOADS_ON_SITE_WIDE)).toBeNull();
  });

  it.each([0, "6", "", "2.5"])("rejects %p with the server's message", (maxFileUploads) => {
    expect(validationError({ allow_learner_uploads: true, max_file_uploads: maxFileUploads }, UPLOADS_ON_SITE_WIDE))
      .toBe("Max File Uploads must be an integer between 1 and 5.");
  });

  it("skips the check while the File Upload toggle is off", () => {
    expect(validationError({ allow_learner_uploads: false, max_file_uploads: 0 }, UPLOADS_ON_SITE_WIDE)).toBeNull();
  });

  it("skips the check while uploads are off site-wide", () => {
    const uploadsOffSiteWide = { ...UPLOADS_ON_SITE_WIDE, learner_uploads_enabled: false };

    expect(validationError({ allow_learner_uploads: true, max_file_uploads: 0 }, uploadsOffSiteWide)).toBeNull();
  });
});
