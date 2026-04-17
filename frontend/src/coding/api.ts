import { postJson } from "../shared/request";

interface Judge0SubmissionResponse {
  submission_id?: string;
  [key: string]: unknown;
}

interface Judge0ResultResponse {
  compile_output?: string;
  status?: { id?: number; [key: string]: unknown };
  stderr?: string;
  stdout?: string;
  [key: string]: unknown;
}

interface CodingFeedbackResponse {
  response?: string;
  [key: string]: unknown;
}

const MAX_JUDGE0_RETRY_ITER = 5;
const WAIT_TIME_MS = 1000;

export function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function submitCode(url: string, code: string) {
  return postJson<Judge0SubmissionResponse>(url, { user_code: code });
}

export async function pollSubmissionResult(url: string, submissionId: string) {
  let retries = 0;

  while (true) {
    const result = await postJson<Judge0ResultResponse>(url, {
      submission_id: submissionId,
    });
    const statusId = Number(result.status?.id || 0);

    if (statusId === 1 || statusId === 2) {
      if (retries >= MAX_JUDGE0_RETRY_ITER) {
        throw new Error(
          `Judge0 submission result fetch failed after ${MAX_JUDGE0_RETRY_ITER} attempts.`,
        );
      }
      retries += 1;
      await wait(WAIT_TIME_MS);
      continue;
    }

    return result;
  }
}

export async function fetchAiFeedback(
  url: string,
  code: string,
  stdout: string,
  stderr: string,
) {
  const response = await postJson<CodingFeedbackResponse>(url, {
    code,
    stdout,
    stderr,
  });
  return response.response || "";
}

export async function resetCodingSession(url: string) {
  return postJson(url, {});
}

export { WAIT_TIME_MS };
