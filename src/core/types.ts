export const TASK_STATUSES = ["待确认", "进行中", "已完成", "已取消"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskRecord {
  summary: string;
  quote: string;
  status: TaskStatus;
  reason: string;
  userEdited: boolean;
}

export interface SegmentRecord {
  headingPath: string[];
  ordinal: number;
  start: number;
  end: number;
  text: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  tags: string[];
  tagsUserEdited: boolean;
  task: TaskRecord | null;
  pendingModel: boolean;
}

export interface FileRecord {
  id: string;
  path: string;
  processedContentHash: string | null;
  segments: SegmentRecord[];
}

export interface UnmatchedTask {
  id: string;
  fileId: string;
  filePath: string;
  headingPath: string[];
  ordinal: number;
  text: string;
  contentHash: string;
  tags: string[];
  tagsUserEdited: boolean;
  task: TaskRecord;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export interface ProjectIndex {
  version: 1;
  files: FileRecord[];
  unmatched: UnmatchedTask[];
}

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const defaultSettings: Settings = {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "ollama",
  model: "llama3.2",
};

export function emptyIndex(): ProjectIndex {
  return { version: 1, files: [], unmatched: [] };
}

export function formatHeadingPath(path: string[]): string {
  return path.join(" / ");
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}
