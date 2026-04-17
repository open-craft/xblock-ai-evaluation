import { postJson } from "../shared/request";

interface ShortAnswerResponse {
  response?: string;
  [key: string]: unknown;
}

export async function sendAnswer(url: string, userInput: string) {
  const response = await postJson<ShortAnswerResponse>(url, { user_input: userInput });
  return response.response || "";
}

export async function resetChat(url: string) {
  return postJson(url, {});
}
