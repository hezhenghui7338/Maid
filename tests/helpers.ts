import { analyzeDocument, updateTaskStatus } from "../src/core/analyze";
import type { ModelClient, ModelCompletion } from "../src/core/model";
import { emptyIndex, type ProjectIndex, type TaskStatus } from "../src/core/types";

let sequence = 0;

export function ids(): () => string {
  return () => {
    sequence += 1;
    return `id-${sequence}`;
  };
}

export function resetIds(): void {
  sequence = 0;
}

export function client(handler: (text: string) => ModelCompletion): {
  complete: ModelClient;
  calls: { segmentText: string; previous: unknown; projectTags: string[] }[];
} {
  const calls: { segmentText: string; previous: unknown; projectTags: string[] }[] = [];
  const complete: ModelClient = async (request) => {
    calls.push({
      segmentText: request.segmentText,
      previous: request.previous,
      projectTags: request.projectTags,
    });
    return handler(request.segmentText);
  };
  return { complete, calls };
}

export function task(status: TaskStatus, quote: string, summary = "去做这件事") {
  return { summary, quote, status, reason: "因为正文提出了动作" };
}

export async function analyzeWith(
  text: string,
  complete: ModelClient,
  index: ProjectIndex = emptyIndex(),
  relativePath = "notes.md",
  maxChars?: number,
): Promise<{ index: ProjectIndex; messages: string[]; requests: number }> {
  const result = await analyzeDocument({
    index,
    relativePath,
    text,
    now: "2026-09-27T12:00:00.000Z",
    complete,
    createId: ids(),
    maxChars,
  });
  return { index: result.index, messages: result.messages, requests: result.requests.length };
}

export async function seedTask(text: string, quote: string, status: TaskStatus = "待确认") {
  const stub = client(() => ({ tags: ["立项计划"], task: task(status, quote) }));
  const result = await analyzeWith(text, stub.complete);
  return result.index;
}

export function setStatus(index: ProjectIndex, status: TaskStatus, ordinal = 0): ProjectIndex {
  const file = index.files[0];
  const segment = file.segments.find((item) => item.ordinal === ordinal) ?? file.segments[0];
  return updateTaskStatus(index, file.path, segment.headingPath, segment.ordinal, status);
}
