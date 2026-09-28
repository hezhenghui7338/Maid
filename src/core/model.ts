import { isStageTag, STAGE_TAGS } from "./stages";
import { isTaskStatus, type TaskRecord, type TaskStatus } from "./types";

export interface ModelCompletion {
  tags: string[];
  task: Omit<TaskRecord, "userEdited"> | null;
}

export interface ModelRequest {
  segmentText: string;
  headingPath: string;
  projectTags: string[];
  previous: {
    tags: string[];
    taskStatus: TaskStatus | null;
    taskSummary: string | null;
    userEdited: boolean;
  } | null;
}

export type ModelClient = (request: ModelRequest) => Promise<ModelCompletion>;

/** 请求没有到达模型接口。分析遇到它时应停住，避免同一故障刷满每一段。 */
export class ModelTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelTransportError";
  }
}

export function parseModelPayload(value: unknown): { ok: true; data: ModelCompletion } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "模型输出不是对象" };
  const extra = Object.keys(value).filter((key) => key !== "tags" && key !== "task");
  if (extra.length > 0) return { ok: false, error: "字段超出约定" };
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")) {
    return { ok: false, error: "标签格式无效" };
  }
  const tags = value.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  if (tags.length > 2) return { ok: false, error: "标签超过两个" };
  if (tags.some((tag) => !isStageTag(tag))) return { ok: false, error: "标签不在固定阶段内" };
  if (Array.isArray(value.task)) return { ok: false, error: "一段最多一条任务" };
  if (value.task === null) return { ok: true, data: { tags: unique(tags), task: null } };
  if (!isRecord(value.task)) return { ok: false, error: "任务格式无效" };
  const taskExtra = Object.keys(value.task).filter(
    (key) => !["summary", "quote", "status", "reason"].includes(key),
  );
  if (taskExtra.length > 0) return { ok: false, error: "字段超出约定" };
  const { summary, quote, status, reason } = value.task;
  if (typeof summary !== "string" || typeof quote !== "string" || typeof reason !== "string") {
    return { ok: false, error: "任务格式无效" };
  }
  if (typeof status !== "string" || !isTaskStatus(status)) return { ok: false, error: "任务状态无效" };
  if (quote.trim().length === 0 || summary.trim().length === 0) return { ok: false, error: "任务缺少摘录或说明" };
  return {
    ok: true,
    data: {
      tags: unique(tags),
      task: { summary: summary.trim(), quote, status, reason: reason.trim() },
    },
  };
}

export function createOpenAIClient(settings: { baseUrl: string; apiKey: string; model: string }): ModelClient {
  return async (request) => {
    const endpoint = `${settings.baseUrl.replace(/\/$/, "")}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "你只输出 JSON 对象，键只有 tags 和 task。tags 是 0 到 2 个主题标签，只能从用户消息里的可选阶段中选择，不要自造说法。task 为 null，或对象 {summary, quote, status, reason}。status 只能是待确认、进行中、已完成、已取消。quote 必须是段正文里的连续原文。不要输出多余字段。只根据这一段正文判断，不要根据同一文档的其他段判断。只有这段里还没做完的事项才建任务。原文已写明解决、完成或修好时，任务为空，不要收成「已完成」。原文已写明放弃、取消或不做时，任务为空，不要收成「已取消」。还没做完时：正在做、未完成或执行中建议「进行中」；只是待办、没有写做到哪一步建议「待确认」。不要把这类未完成事项标成「已完成」或「已取消」。",
            },
            { role: "user", content: promptFor(request) },
          ],
        }),
      });
    } catch (error) {
      throw new ModelTransportError(transportMessage(endpoint, error));
    }
    if (!response.ok) {
      throw new Error(`模型请求失败：${response.status}`);
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    const parsed = parseModelPayload(parseContent(content));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.data;
  };
}

function transportMessage(endpoint: string, error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : "";
  const opaque = /^(typeerror:\s*)?(load failed|failed to fetch|networkerror( when attempting to fetch resource)?\.?)$/i.test(raw);
  const reason = opaque || raw.length === 0
    ? "请求没有到达。请确认接口地址可访问；使用本机 Ollama 时要先启动服务"
    : raw;
  return `连不上模型接口 ${endpoint}：${reason}`;
}

function promptFor(request: ModelRequest): string {
  const previous = request.previous
    ? `上一轮标签：${request.previous.tags.join("、") || "无"}。上一轮任务状态：${request.previous.taskStatus ?? "无"}。上一轮任务说明：${request.previous.taskSummary ?? "无"}。是否用户手改：${request.previous.userEdited ? "是" : "否"}。`
    : "没有上一轮记录。";
  return [
    `标题路径：${request.headingPath || "（无标题）"}`,
    `可选阶段：${STAGE_TAGS.join("、")}`,
    previous,
    "段正文：",
    request.segmentText,
  ].join("\n");
}

function parseContent(content: unknown): unknown {
  const text = Array.isArray(content)
    ? content.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("")
    : typeof content === "string"
      ? content
      : "";
  const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(stripped) as unknown;
}

function unique(tags: string[]): string[] {
  return [...new Set(tags)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
