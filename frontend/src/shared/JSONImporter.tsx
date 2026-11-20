import React, { useCallback, useState } from "react";
import * as Yup from "yup";
import {
  Alert, Button, Dropzone, Form,
} from "@openedx/paragon";

import { getErrorMessage, RequestError } from "./request";
import {
  collectYupErrors,
  normalizeValidationErrors,
  notifyRuntime,
  submitStudioPayload,
  ValidationErrors,
} from "./studio";
import { UnknownRecord, XBlockElementLike, XBlockRuntime } from "./types";

interface JSONImporterProps {
  liveData: unknown;
  runtime: XBlockRuntime;
  element: XBlockElementLike;
  exportFilename: string;
  schema: Yup.Schema<any>;
}

interface FileData {
  get(key: string): Blob;
}

interface ProcessUploadParams {
  fileData: FileData;
  handleError(error: Error): void;
}

type UploadError = string | ValidationErrors;

const IMPORT_ERROR_NOTICE = {
  title: "Unable to import JSON",
  message: "Please fix the validation issues and try again.",
};

const toError = (error: unknown) => (
  error instanceof Error ? error : new Error("Upload failed.")
);

/**
 * Wrapper around the FileReader API that transforms the callbacks
 * to a Promise based one.
 **/
async function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => resolve(String(e.target?.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read the file."));
    reader.readAsText(file);
  });
}

async function parseJsonFile(file: Blob): Promise<UnknownRecord> {
  return JSON.parse(await readFileText(file)) as UnknownRecord;
}

/** Turn an exception from the save handler into something the alert can display. */
function getRequestUploadError(error: unknown): UploadError {
  if (error instanceof RequestError) {
    const payloadError = (error.payload as UnknownRecord).error;
    if (payloadError && typeof payloadError === "object") {
      return normalizeValidationErrors(payloadError);
    }
  }
  return getErrorMessage(error, "Upload failed.");
}

/**
 * Import/export the authored XBlock data as JSON from the Studio editor.
 *
 */
export function JSONImporter({
  exportFilename,
  liveData,
  runtime,
  element,
  schema,
}: JSONImporterProps) {
  const [uploadError, setUploadError] = useState<UploadError | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const saveUrl = runtime.handlerUrl(element, "studio_submit");

  /** JSON Validation once the file is selected. Uses Yup schema if available for
   *  detailed error reporting. Otherwise just verifies that the JSON is valid.
   **/
  const validateFile = useCallback(async (file: File): Promise<string | null> => {
    let parsed: UnknownRecord;
    try {
      parsed = await parseJsonFile(file);
    } catch {
      setUploadError("Invalid JSON.");
      return "Invalid JSON.";
    }

    try {
      // Imported JSON must match the authored types exactly. Yup's default
      // casting would silently turn null/false/0 into strings for
      // `Yup.string().ensure()` fields, letting bad data through.
      await schema.validate(parsed, { abortEarly: false, strict: true });
    } catch (error) {
      const yupErrors = error instanceof Yup.ValidationError ? collectYupErrors(error) : {};
      setUploadError(
        Object.keys(yupErrors).length > 0
          ? yupErrors
          : getErrorMessage(error, "Validation failed."),
      );
      return "Validation failed.";
    }

    setUploadError(null);
    return null;
  }, [schema]);

  /** Upload the JSON to the backend and handle any errors it returns */
  const processUpload = useCallback(async ({
    fileData,
    handleError,
  }: ProcessUploadParams) => {
    let parsed: UnknownRecord;
    try {
      parsed = await parseJsonFile(fileData.get("file"));
    } catch (error) {
      handleError(toError(error));
      return;
    }

    setIsUploading(true);
    notifyRuntime(runtime, "save", { state: "start" });

    let failure: UploadError;
    let failureCause: Error;
    try {
      const response = await submitStudioPayload(saveUrl, parsed);
      if (response.success) {
        notifyRuntime(runtime, "save", { state: "end" });
        return;
      }
      failure = normalizeValidationErrors(response.validation_errors);
      failureCause = new Error("Upload rejected.");
    } catch (error) {
      failure = getRequestUploadError(error);
      failureCause = toError(error);
    } finally {
      setIsUploading(false);
    }

    setUploadError(failure);
    notifyRuntime(runtime, "error", IMPORT_ERROR_NOTICE);
    handleError(failureCause);
  }, [runtime, saveUrl]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(liveData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }, [exportFilename, liveData]);

  return (
    <>
      <Form.Group className="d-flex flex-column p-0">
        <Form.Label>Import</Form.Label>
        <Dropzone
          className="w-100"
          onProcessUpload={processUpload}
          accept={{
            "application/json": [".json"],
          }}
          validator={validateFile}
        />
      </Form.Group>

      {uploadError && (
        <Alert variant="danger" className="mt-3 text-dark">
          <Alert.Heading>JSON validation failed!</Alert.Heading>
          {typeof uploadError === "string" ? (
            <p className="mb-0">{uploadError}</p>
          ) : (
            <ul className="mb-0 pl-3">
              {Object.entries(uploadError).map(([field, messages]) => (
                <li key={field}>
                  <code>{field}</code>
                  <ul>
                    {messages.map((message, index) => (
                      <li key={String(index)}>{message}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <div className="mt-2">
        <h4 className="h4">Export</h4>
        <p>
          <Button
            variant="secondary"
            className="my-2"
            onClick={exportJson}
            disabled={isUploading}
          >
            Download JSON
          </Button>
          <br />
          <small>
            The JSON file will contain the current values to use as a template.
          </small>
        </p>
      </div>
    </>
  );
}

export default JSONImporter;
