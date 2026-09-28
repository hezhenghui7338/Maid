import { alignSegments, type AlignResult } from "./align";
import { contentHash } from "./hash";
import { isStageTag, STAGE_TAGS } from "./stages";
import { ModelTransportError, parseModelPayload, type ModelClient, type ModelRequest } from "./model";
import { segmentMarkdown } from "./segment";
import {
  emptyIndex,
  formatHeadingPath,
  type FileRecord,
  type ProjectIndex,
  type SegmentRecord,
  type TaskRecord,
  type TaskStatus,
  type UnmatchedTask,
} from "./types";

export interface SearchScope {
  kind: "root" | "folder" | "file";
  path?: string;
}

export interface AnalyzeSegmentTarget {
  headingPath: string[];
  ordinal: number;
}

export interface AnalyzeInput {
  index: ProjectIndex;
  relativePath: string;
  text: string;
  now: string;
  complete: ModelClient;
  createId?: () => string;
  maxChars?: number;
  scope?: SearchScope;
  target?: AnalyzeSegmentTarget;
}

export interface AnalyzeOutput {
  index: ProjectIndex;
  messages: string[];
  requests: ModelRequest[];
}

export function analyzeDocument(input: AnalyzeInput): Promise<AnalyzeOutput> {
  return analyzeDocumentAsync(input);
}

async function analyzeDocumentAsync(input: AnalyzeInput): Promise<AnalyzeOutput> {
  const createId = input.createId ?? (() => crypto.randomUUID());
  const index = cloneIndex(input.index);
  const existing = index.files.find((file) => file.path === input.relativePath);
  const fileId = existing?.id ?? createId();
  const drafts = segmentMarkdown(input.text, { maxChars: input.maxChars });
  const carried = [
    ...(existing?.segments ?? []),
    ...index.unmatched
      .filter((item) => item.fileId === fileId)
      .map(unmatchedToSegment),
  ];
  const aligned = alignSegments(carried, drafts);
  const projectTags = modelTagChoices(index, input.scope);
  if (input.target) {
    return analyzeTarget(input, index, existing, fileId, aligned, carried, projectTags);
  }
  const requests: ModelRequest[] = [];
  const messages: string[] = [];
  let pending = false;
  let transportDown = false;
  const segments: SegmentRecord[] = [];

  for (const pair of aligned.pairs) {
    if (pair.kind === "unchanged") {
      segments.push(place(pair.previous, pair.draft));
      continue;
    }
    const previous = pair.kind === "changed" ? pair.previous : null;
    if (transportDown) {
      pending = true;
      segments.push(retainFailed(pair.draft, input.now, previous));
      continue;
    }
    const request: ModelRequest = {
      segmentText: pair.draft.text,
      headingPath: formatHeadingPath(pair.draft.headingPath),
      projectTags,
      previous: previous
        ? {
            tags: previous.tags,
            taskStatus: previous.task?.status ?? null,
            taskSummary: previous.task?.summary ?? null,
            userEdited: Boolean(previous.tagsUserEdited || previous.task?.userEdited),
          }
        : null,
    };
    requests.push(request);
    try {
      const completion = parseModelPayload(await input.complete(request));
      if (!completion.ok) throw new Error(completion.error);
      const task = completion.data.task;
      if (task && !pair.draft.text.includes(task.quote)) {
        throw new Error("摘录不在段正文中");
      }
      const record = baseRecord(pair.draft, input.now, previous);
      record.tags = completion.data.tags;
      record.tagsUserEdited = false;
      record.task = task ? { ...task, userEdited: false } : null;
      record.pendingModel = false;
      record.processedAt = input.now;
      record.updatedAt = previous && previous.contentHash === pair.draft.contentHash ? previous.updatedAt : input.now;
      segments.push(record);
    } catch (error) {
      pending = true;
      const message = error instanceof Error ? error.message : "模型失败";
      const line = `${labelOf(pair.draft.headingPath)}没有更新：${message}`;
      if (!messages.includes(line)) messages.push(line);
      segments.push(retainFailed(pair.draft, input.now, previous));
      if (error instanceof ModelTransportError) transportDown = true;
    }
  }

  const unmatched = [
    ...index.unmatched.filter((item) => item.fileId !== fileId),
    ...aligned.unmatched.map((segment) =>
      segmentToUnmatched(segment, fileId, input.relativePath, createId),
    ),
  ];
  const file: FileRecord = {
    id: fileId,
    path: input.relativePath,
    processedContentHash: pending ? existing?.processedContentHash ?? null : contentHash(input.text),
    segments,
  };
  const files = existing
    ? index.files.map((item) => (item.path === input.relativePath ? file : item))
    : [...index.files, file];
  return { index: { version: 1, files, unmatched }, messages, requests };
}

async function analyzeTarget(
  input: AnalyzeInput,
  index: ProjectIndex,
  existing: FileRecord | undefined,
  fileId: string,
  aligned: AlignResult,
  carried: SegmentRecord[],
  projectTags: string[],
): Promise<AnalyzeOutput> {
  const target = input.target;
  if (!target) return { index: input.index, messages: ["需要改用全文分析"], requests: [] };
  const keep = { index: input.index, messages: [] as string[], requests: [] as ModelRequest[] };
  const refuse = { index: input.index, messages: ["需要改用全文分析"], requests: [] as ModelRequest[] };
  const pair = aligned.pairs.find((item) => sameAddress(item.draft, target.headingPath, target.ordinal));
  if (!pair) return refuse;
  const hadIdentity = carried.some((segment) => sameAddress(segment, target.headingPath, target.ordinal));
  if (pair.kind === "fresh") {
    if (hadIdentity) return refuse;
    return finishTarget(await completeDraft(input, projectTags, pair.draft, null), index, existing, fileId, input.relativePath, target);
  }
  if (!sameAddress(pair.previous, target.headingPath, target.ordinal)) return refuse;
  if (absorbedNeighbor(pair.draft.text, pair.previous, carried)) return refuse;
  if (pair.kind === "unchanged") return keep;
  return finishTarget(await completeDraft(input, projectTags, pair.draft, pair.previous), index, existing, fileId, input.relativePath, target);
}

async function completeDraft(
  input: AnalyzeInput,
  projectTags: string[],
  draft: AlignResult["pairs"][number]["draft"],
  previous: SegmentRecord | null,
): Promise<{ record: SegmentRecord | null; requests: ModelRequest[]; messages: string[] }> {
  const request: ModelRequest = {
    segmentText: draft.text,
    headingPath: formatHeadingPath(draft.headingPath),
    projectTags,
    previous: previous
      ? {
          tags: previous.tags,
          taskStatus: previous.task?.status ?? null,
          taskSummary: previous.task?.summary ?? null,
          userEdited: Boolean(previous.tagsUserEdited || previous.task?.userEdited),
        }
      : null,
  };
  try {
    const completion = parseModelPayload(await input.complete(request));
    if (!completion.ok) throw new Error(completion.error);
    const task = completion.data.task;
    if (task && !draft.text.includes(task.quote)) throw new Error("摘录不在段正文中");
    const record = baseRecord(draft, input.now, previous);
    record.tags = completion.data.tags;
    record.tagsUserEdited = false;
    record.task = task ? { ...task, userEdited: false } : null;
    record.pendingModel = false;
    record.processedAt = input.now;
    record.updatedAt = previous && previous.contentHash === draft.contentHash ? previous.updatedAt : input.now;
    return { record, requests: [request], messages: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "模型失败";
    return { record: null, requests: [request], messages: [`${labelOf(draft.headingPath)}没有更新：${message}`] };
  }
}

function finishTarget(
  written: { record: SegmentRecord | null; requests: ModelRequest[]; messages: string[] },
  index: ProjectIndex,
  existing: FileRecord | undefined,
  fileId: string,
  relativePath: string,
  target: AnalyzeSegmentTarget,
): AnalyzeOutput {
  if (!written.record) return { index, messages: written.messages, requests: written.requests };
  const segments = placeTarget(existing?.segments ?? [], written.record, target);
  const file: FileRecord = {
    id: fileId,
    path: relativePath,
    processedContentHash: existing?.processedContentHash ?? null,
    segments,
  };
  const files = existing
    ? index.files.map((item) => (item.path === relativePath ? file : item))
    : [...index.files, file];
  return { index: { version: 1, files, unmatched: index.unmatched }, messages: written.messages, requests: written.requests };
}

function placeTarget(segments: SegmentRecord[], record: SegmentRecord, target: AnalyzeSegmentTarget): SegmentRecord[] {
  if (!segments.some((segment) => sameAddress(segment, target.headingPath, target.ordinal))) {
    return [...segments, record];
  }
  return segments.map((segment) => (sameAddress(segment, target.headingPath, target.ordinal) ? record : segment));
}

function absorbedNeighbor(text: string, previous: SegmentRecord, carried: SegmentRecord[]): boolean {
  return carried.some((segment) => segment !== previous && segment.text.trim().length > 0 && text.includes(segment.text.trim()));
}

export function updateSegmentTags(
  index: ProjectIndex,
  relativePath: string,
  headingPath: string[],
  ordinal: number,
  tags: string[],
): { index: ProjectIndex; ok: boolean } {
  const nextTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  if (nextTags.length > 2) return { index, ok: false };
  const current = index.files
    .find((file) => file.path === relativePath)
    ?.segments.find((segment) => sameAddress(segment, headingPath, ordinal));
  if (current) {
    const introduced = nextTags.filter((tag) => !current.tags.includes(tag));
    if (introduced.some((tag) => !isStageTag(tag))) return { index, ok: false };
  }
  return {
    ok: true,
    index: mapSegment(index, relativePath, headingPath, ordinal, (segment) => ({
      ...segment,
      tags: nextTags,
      tagsUserEdited: true,
      pendingModel: false,
    })),
  };
}

export function updateTaskStatus(
  index: ProjectIndex,
  relativePath: string,
  headingPath: string[],
  ordinal: number,
  status: TaskStatus,
): ProjectIndex {
  return mapSegment(index, relativePath, headingPath, ordinal, (segment) => {
    if (!segment.task) return segment;
    return {
      ...segment,
      pendingModel: false,
      task: { ...segment.task, status, userEdited: true },
    };
  });
}

export function dismissUnmatched(index: ProjectIndex, unmatchedId: string): ProjectIndex {
  return {
    ...index,
    unmatched: index.unmatched.filter((item) => item.id !== unmatchedId),
  };
}

export function renameIndexedFile(index: ProjectIndex, from: string, to: string): ProjectIndex {
  if (parentPath(from) !== parentPath(to)) {
    throw new Error("不支持移动文件");
  }
  return {
    ...index,
    files: index.files.map((file) => ({ ...file, path: retargetPath(file.path, from, to) })),
    unmatched: index.unmatched.map((item) => ({ ...item, filePath: retargetPath(item.filePath, from, to) })),
  };
}

export function removeIndexedFile(index: ProjectIndex, relativePath: string): ProjectIndex {
  const removed = new Set(index.files.filter((file) => pathInNode(file.path, relativePath)).map((file) => file.id));
  return {
    ...index,
    files: index.files.filter((item) => !pathInNode(item.path, relativePath)),
    unmatched: index.unmatched.filter((item) => !pathInNode(item.filePath, relativePath) && !removed.has(item.fileId)),
  };
}

export function pathInScope(path: string, scope?: SearchScope): boolean {
  if (!scope || scope.kind === "root" || !scope.path) return true;
  if (scope.kind === "file") return path === scope.path;
  return pathInNode(path, scope.path);
}

export function searchHits(
  index: ProjectIndex,
  query: { tag?: string; status?: TaskStatus },
  scope?: SearchScope,
): SearchHit[] {
  const hits: SearchHit[] = [];
  const files = [...index.files]
    .filter((file) => pathInScope(file.path, scope))
    .sort((left, right) => left.path.localeCompare(right.path, "zh"));
  for (const file of files) {
    const ordered = [...file.segments].sort((left, right) => left.start - right.start);
    ordered.forEach((segment, indexInFile) => {
      const tagOk = !query.tag || segment.tags.includes(query.tag);
      const statusOk = !query.status || segment.task?.status === query.status;
      if (!tagOk || !statusOk) return;
      if (query.status && !segment.task) return;
      const neighbors = [ordered[indexInFile - 1], ordered[indexInFile + 1]].filter(
        (item): item is SegmentRecord => Boolean(item),
      );
      hits.push({
        fileId: file.id,
        path: file.path,
        headingPath: segment.headingPath,
        ordinal: segment.ordinal,
        text: segment.text,
        start: segment.start,
        end: segment.end,
        tags: segment.tags,
        task: segment.task,
        neighbors: neighbors.map((item) => ({
          headingPath: item.headingPath,
          text: item.text,
        })),
      });
    });
  }
  return hits;
}

export interface SearchHit {
  fileId: string;
  path: string;
  headingPath: string[];
  ordinal: number;
  text: string;
  start: number;
  end: number;
  tags: string[];
  task: TaskRecord | null;
  neighbors: { headingPath: string[]; text: string }[];
}

export function isFileStale(file: FileRecord | undefined, text: string): boolean {
  if (!file?.processedContentHash) return true;
  return file.processedContentHash !== contentHash(text);
}

export function collectTags(index: ProjectIndex, scope?: SearchScope): string[] {
  const tags = new Set<string>();
  for (const file of index.files) {
    if (!pathInScope(file.path, scope)) continue;
    for (const segment of file.segments) {
      for (const tag of segment.tags) tags.add(tag);
    }
  }
  return [...tags];
}

function modelTagChoices(index: ProjectIndex, scope?: SearchScope): string[] {
  const inScope = collectTags(index, scope).filter((tag) => isStageTag(tag));
  return [...new Set([...STAGE_TAGS, ...inScope])];
}

function pathInNode(path: string, node: string): boolean {
  return path === node || path.startsWith(`${node}/`);
}

function retargetPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  const prefix = `${from}/`;
  if (path.startsWith(prefix)) return `${to}/${path.slice(prefix.length)}`;
  return path;
}

export function parentPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

export function assertSafeRelative(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error("非法路径");
  }
  return normalized;
}

export function exportDocument(markdown: string): string {
  return markdown;
}

function place(previous: SegmentRecord, draft: { headingPath: string[]; ordinal: number; start: number; end: number; text: string; contentHash: string }): SegmentRecord {
  return {
    ...previous,
    headingPath: draft.headingPath,
    ordinal: draft.ordinal,
    start: draft.start,
    end: draft.end,
    text: draft.text,
    contentHash: draft.contentHash,
  };
}

function retainFailed(
  draft: { headingPath: string[]; ordinal: number; start: number; end: number; text: string; contentHash: string },
  now: string,
  previous: SegmentRecord | null,
): SegmentRecord {
  if (previous) return { ...place(previous, draft), pendingModel: true };
  const blank = baseRecord(draft, now, null);
  blank.pendingModel = true;
  blank.processedAt = null;
  return blank;
}

function baseRecord(
  draft: { headingPath: string[]; ordinal: number; start: number; end: number; text: string; contentHash: string },
  now: string,
  previous: SegmentRecord | null,
): SegmentRecord {
  return {
    headingPath: draft.headingPath,
    ordinal: draft.ordinal,
    start: draft.start,
    end: draft.end,
    text: draft.text,
    contentHash: draft.contentHash,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    processedAt: null,
    tags: previous?.tags ?? [],
    tagsUserEdited: previous?.tagsUserEdited ?? false,
    task: previous?.task ?? null,
    pendingModel: false,
  };
}

function unmatchedToSegment(item: UnmatchedTask): SegmentRecord {
  return {
    headingPath: item.headingPath,
    ordinal: item.ordinal,
    start: -1,
    end: -1,
    text: item.text,
    contentHash: item.contentHash,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    processedAt: item.processedAt,
    tags: item.tags,
    tagsUserEdited: item.tagsUserEdited,
    task: item.task,
    pendingModel: false,
  };
}

function segmentToUnmatched(
  segment: SegmentRecord,
  fileId: string,
  filePath: string,
  createId: () => string,
): UnmatchedTask {
  if (!segment.task) throw new Error("未匹配项缺少任务");
  return {
    id: createId(),
    fileId,
    filePath,
    headingPath: segment.headingPath,
    ordinal: segment.ordinal,
    text: segment.text,
    contentHash: segment.contentHash,
    tags: segment.tags,
    tagsUserEdited: segment.tagsUserEdited,
    task: segment.task,
    createdAt: segment.createdAt,
    updatedAt: segment.updatedAt,
    processedAt: segment.processedAt,
  };
}

function labelOf(path: string[]): string {
  return formatHeadingPath(path) || "文档开头";
}

function mapSegment(
  index: ProjectIndex,
  relativePath: string,
  headingPath: string[],
  ordinal: number,
  update: (segment: SegmentRecord) => SegmentRecord,
): ProjectIndex {
  return {
    ...index,
    files: index.files.map((file) => {
      if (file.path !== relativePath) return file;
      return {
        ...file,
        segments: file.segments.map((segment) =>
          sameAddress(segment, headingPath, ordinal) ? update(segment) : segment,
        ),
      };
    }),
  };
}

function sameAddress(segment: { headingPath: string[]; ordinal: number }, headingPath: string[], ordinal: number): boolean {
  return segment.ordinal === ordinal && segment.headingPath.join("\u0000") === headingPath.join("\u0000");
}

function cloneIndex(index: ProjectIndex): ProjectIndex {
  return structuredClone(index.version ? index : emptyIndex());
}
