import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeDocument,
  dismissUnmatched,
  isFileStale,
  removeIndexedFile,
  renameIndexedFile,
  searchHits,
  updateSegmentTags,
  updateTaskStatus,
} from "../src/core/analyze";
import { contentHash } from "../src/core/hash";
import { ModelTransportError, createOpenAIClient, parseModelPayload } from "../src/core/model";
import { STAGE_TAGS } from "../src/core/stages";
import { emptyIndex, type FileRecord, type ProjectIndex, type TaskStatus } from "../src/core/types";
import { analyzeWith, client, ids, resetIds, seedTask, task } from "./helpers";

describe("分析与索引", () => {
  it("IX-01 分析不改写 Markdown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maid-"));
    const file = join(dir, "notes.md");
    const source = "# 立项\n\n第一段说明。\n";
    await writeFile(file, source);
    const before = await readFile(file);
    const result = await analyzeWith(source, client(() => ({ tags: ["立项计划"], task: null })).complete);
    await writeFile(join(dir, "index.json"), JSON.stringify(result.index));
    expect(await readFile(file)).toEqual(before);
    expect(result.index.files[0].segments[0].tags).toEqual(["立项计划"]);
  });

  it("IX-02 段记录带有文件身份、范围和哈希", async () => {
    const result = await analyzeWith("# 立项\n\n说明正文。\n", client(() => ({ tags: [], task: null })).complete);
    const file = result.index.files[0];
    const segment = file.segments[0];
    expect(file.id).toBeTruthy();
    expect(segment.start).toBeGreaterThanOrEqual(0);
    expect(segment.end).toBeGreaterThan(segment.start);
    expect(segment.contentHash).toBe(contentHash(segment.text));
    expect(segment.createdAt).toBeTruthy();
    expect(segment.processedAt).toBeTruthy();
  });

  it("AN-02 正文未变时不调用模型并保留手改", async () => {
    resetIds();
    const source = "# 计划\n\n需要完成上线检查。\n";
    let index = await seedTask(source, "需要完成上线检查。");
    const segment = index.files[0].segments[0];
    index = updateTaskStatus(index, "notes.md", segment.headingPath, segment.ordinal, "进行中");
    const tagged = updateSegmentTags(index, "notes.md", segment.headingPath, segment.ordinal, ["上线运营"]);
    expect(tagged.ok).toBe(true);
    const stub = client(() => ({ tags: ["技术实现"], task: task("已完成", "需要完成上线检查。") }));
    const again = await analyzeWith(source, stub.complete, tagged.index);
    expect(stub.calls).toHaveLength(0);
    expect(again.index.files[0].segments[0].task?.status).toBe("进行中");
    expect(again.index.files[0].segments[0].tags).toEqual(["上线运营"]);
    expect(again.index.files[0].segments[0].task?.userEdited).toBe(true);
  });

  it("AN-03 未改的段不调用模型", async () => {
    const source = "# 文档\n\n甲段保持不动。\n\n乙段稍后会改。\n";
    const seeded = await analyzeWith(
      source,
      client((text) => ({ tags: [text.includes("甲") ? "立项计划" : "产品调研"], task: null })).complete,
      emptyIndex(),
      "notes.md",
      12,
    );
    const changed = source.replace("乙段稍后会改。", "乙段已经改写。");
    const stub = client(() => ({ tags: ["产品调研"], task: null }));
    const again = await analyzeWith(changed, stub.complete, seeded.index, "notes.md", 12);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].segmentText).toContain("乙段已经改写");
    const kept = again.index.files[0].segments.find((segment) => segment.text.includes("甲段"));
    expect(kept?.tags).toEqual(["立项计划"]);
  });

  it("AN-12 只再分析所选段时其他过期段不动", async () => {
    const source = "# 甲\n\n甲段原来的句子。\n\n# 乙\n\n乙段原来的句子。\n";
    let index = (
      await analyzeWith(
        source,
        client((text) => ({
          tags: [text.includes("甲") ? "立项计划" : "产品调研"],
          task: task("待确认", text.trim()),
        })).complete,
      )
    ).index;
    const yi = index.files[0].segments.find((segment) => segment.text.includes("乙"));
    expect(yi?.task).toBeTruthy();
    if (!yi) return;
    index = updateTaskStatus(index, "notes.md", yi.headingPath, yi.ordinal, "进行中");
    const tagged = updateSegmentTags(index, "notes.md", yi.headingPath, yi.ordinal, ["上线运营"]);
    expect(tagged.ok).toBe(true);
    index = tagged.index;
    const changed = "# 甲\n\n甲段改过的句子。\n\n# 乙\n\n乙段改过的句子。\n";
    const jia = index.files[0].segments.find((segment) => segment.text.includes("甲"));
    expect(jia).toBeTruthy();
    if (!jia) return;
    const stub = client(() => ({ tags: ["技术实现"], task: task("已完成", "甲段改过的句子。") }));
    const again = await analyzeDocument({
      index,
      relativePath: "notes.md",
      text: changed,
      now: "2026-09-27T15:00:00.000Z",
      complete: stub.complete,
      createId: ids(),
      target: { headingPath: jia.headingPath, ordinal: jia.ordinal },
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].segmentText).toContain("甲段改过的句子");
    const kept = again.index.files[0].segments.find((segment) => segment.headingPath.join("/") === yi.headingPath.join("/"));
    expect(kept?.tags).toEqual(["上线运营"]);
    expect(kept?.tagsUserEdited).toBe(true);
    expect(kept?.task?.status).toBe("进行中");
    expect(kept?.task?.userEdited).toBe(true);
    expect(kept?.text).toBe(yi.text);
    expect(again.index.files[0].processedContentHash).toBe(index.files[0].processedContentHash);
    expect(again.index.files[0].segments.find((segment) => segment.text.includes("甲段改过"))?.processedAt).toBe("2026-09-27T15:00:00.000Z");
  });

  it("AN-13 所选段正文未变时不调用模型", async () => {
    const source = "# 甲\n\n甲段原来的句子。\n";
    const index = await seedTask(source, "甲段原来的句子。", "进行中");
    const segment = index.files[0].segments[0];
    const stub = client(() => ({ tags: ["不该出现"], task: task("已完成", "甲段原来的句子。") }));
    const again = await analyzeDocument({
      index,
      relativePath: "notes.md",
      text: source,
      now: "2026-09-27T15:00:00.000Z",
      complete: stub.complete,
      createId: ids(),
      target: { headingPath: segment.headingPath, ordinal: segment.ordinal },
    });
    expect(stub.calls).toHaveLength(0);
    expect(again.index.files[0].segments[0].tags).toEqual(["立项计划"]);
    expect(again.index.files[0].segments[0].task?.status).toBe("进行中");
  });

  it("AN-14 切开或合并后不调用模型", async () => {
    const source = "# 甲\n\n请完成登录和注册的实现。\n";
    const index = await seedTask(source, "请完成登录和注册的实现。", "进行中");
    const segment = index.files[0].segments[0];
    const split = "# 甲\n\n请完成登录的实现。\n\n请完成注册的实现。\n";
    const stub = client((text) => ({ tags: ["技术实现"], task: task("待确认", text.trim()) }));
    const again = await analyzeDocument({
      index,
      relativePath: "notes.md",
      text: split,
      now: "2026-09-27T15:00:00.000Z",
      complete: stub.complete,
      createId: ids(),
      maxChars: 10,
      target: { headingPath: segment.headingPath, ordinal: segment.ordinal },
    });
    expect(stub.calls).toHaveLength(0);
    expect(again.messages.join("")).toContain("需要改用全文分析");
    expect(again.index.files[0].segments).toEqual(index.files[0].segments);
    expect(again.index.files[0].processedContentHash).toBe(index.files[0].processedContentHash);

    const mergedSource = "# 笔记\n\n请完成登录的实现。\n\n请完成注册的实现。\n";
    const seeded = await analyzeWith(
      mergedSource,
      client((text) => ({ tags: ["技术实现"], task: task("待确认", text.trim()) })).complete,
      emptyIndex(),
      "notes.md",
      16,
    );
    const first = seeded.index.files[0].segments[0];
    const mergeStub = client(() => ({ tags: ["技术实现"], task: task("待确认", "请完成登录的实现。") }));
    const merged = await analyzeDocument({
      index: seeded.index,
      relativePath: "notes.md",
      text: "# 笔记\n\n请完成登录的实现。请完成注册的实现。\n",
      now: "2026-09-27T15:00:00.000Z",
      complete: mergeStub.complete,
      createId: ids(),
      target: { headingPath: first.headingPath, ordinal: first.ordinal },
    });
    expect(mergeStub.calls).toHaveLength(0);
    expect(merged.messages.join("")).toContain("需要改用全文分析");
    expect(merged.index.files[0].segments).toEqual(seeded.index.files[0].segments);
  });

  it("按段分析新身份时不带旧任务", async () => {
    const source = "# 甲\n\n甲段原来的句子。\n";
    const index = await seedTask(source, "甲段原来的句子。");
    const added = "# 甲\n\n甲段原来的句子。\n\n# 丙\n\n从未出现的新句子。\n";
    const stub = client(() => ({ tags: ["立项计划"], task: task("待确认", "从未出现的新句子。") }));
    const again = await analyzeDocument({
      index,
      relativePath: "notes.md",
      text: added,
      now: "2026-09-27T15:00:00.000Z",
      complete: stub.complete,
      createId: ids(),
      target: { headingPath: ["丙"], ordinal: 0 },
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].previous).toBeNull();
    expect(again.index.files[0].segments.find((segment) => segment.text.includes("甲"))?.tags).toEqual(["立项计划"]);
    expect(again.index.files[0].processedContentHash).toBe(index.files[0].processedContentHash);
    expect(again.index.files[0].segments.some((segment) => segment.text.includes("从未出现"))).toBe(true);
  });

  it("AN-04 正文变更后模型状态覆盖手改", async () => {
    const source = "# 计划\n\n需要完成上线检查。\n";
    let index = await seedTask(source, "需要完成上线检查。");
    const segment = index.files[0].segments[0];
    index = updateTaskStatus(index, "notes.md", segment.headingPath, segment.ordinal, "进行中");
    const changed = "# 计划\n\n需要完成上线检查，并补充回滚步骤。\n";
    const quote = "需要完成上线检查，并补充回滚步骤。";
    const stub = client(() => ({ tags: ["上线运营"], task: task("已完成", quote, "补回滚") }));
    const again = await analyzeWith(changed, stub.complete, index);
    expect(stub.calls[0].previous).toMatchObject({ taskStatus: "进行中", userEdited: true });
    expect(again.index.files[0].segments[0].task?.status).toBe("已完成");
    expect(again.index.files[0].segments[0].task?.userEdited).toBe(false);
    const frozen = client(() => ({ tags: ["不该出现"], task: task("待确认", quote) }));
    const third = await analyzeWith(changed, frozen.complete, again.index);
    expect(frozen.calls).toHaveLength(0);
    expect(third.index.files[0].segments[0].task?.status).toBe("已完成");
  });

  it("AN-05 删除段落后任务进入未匹配", async () => {
    const source = "# 计划\n\n需要完成上线检查。\n\n# 备注\n\n这里只是背景。\n";
    const index = await seedTask(source, "需要完成上线检查。", "进行中");
    const stub = client(() => ({ tags: ["项目复盘"], task: null }));
    const again = await analyzeWith(
      "# 备注\n\n这里只是背景。\n",
      stub.complete,
      index,
    );
    expect(again.index.unmatched).toHaveLength(1);
    expect(again.index.unmatched[0].task.status).toBe("进行中");
    expect(again.index.unmatched[0].task.summary).toBe("去做这件事");
    expect(again.index.files[0].segments.some((segment) => segment.task?.summary === "去做这件事")).toBe(false);
  });

  it("AN-06 切开后旧任务进入未匹配", async () => {
    const source = "# 笔记\n\n请完成登录和注册的实现。\n";
    const index = await seedTask(source, "请完成登录和注册的实现。", "进行中");
    const next = "# 笔记\n\n请完成登录的实现。\n\n请完成注册的实现。\n";
    const stub = client((text) => ({ tags: ["技术实现"], task: task("待确认", text.trim()) }));
    const again = await analyzeWith(next, stub.complete, index, "notes.md", 10);
    expect(again.index.unmatched).toHaveLength(1);
    expect(again.index.unmatched[0].task.status).toBe("进行中");
    expect(again.index.files[0].segments.every((segment) => segment.task?.status !== "进行中")).toBe(true);
    expect(stub.calls.every((call) => call.previous === null)).toBe(true);
  });

  it("AN-07 合并后旧任务都进入未匹配", async () => {
    const source = "# 笔记\n\n请完成登录的实现。\n\n请完成注册的实现。\n";
    const first = await analyzeWith(
      source,
      client((text) => ({ tags: ["技术实现"], task: task("待确认", text.trim(), text.trim()) })).complete,
      emptyIndex(),
      "notes.md",
      16,
    );
    expect(first.index.files[0].segments.filter((segment) => segment.task)).toHaveLength(2);
    const merged = "# 笔记\n\n请完成登录的实现。请完成注册的实现。\n";
    const stub = client((text) => ({ tags: ["技术实现"], task: task("待确认", "请完成登录的实现。") }));
    const again = await analyzeWith(merged, stub.complete, first.index);
    expect(again.index.unmatched).toHaveLength(2);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].previous).toBeNull();
  });

  it("AN-08 正文变化后索引过期", async () => {
    const source = "# 计划\n\n需要完成上线检查。\n";
    const result = await analyzeWith(source, client(() => ({ tags: ["上线运营"], task: null })).complete);
    expect(isFileStale(result.index.files[0], source)).toBe(false);
    expect(isFileStale(result.index.files[0], `${source}\n补充。\n`)).toBe(true);
  });

  it("AN-09 模型失败时保留上一轮", async () => {
    const source = "# 计划\n\n需要完成上线检查。\n";
    const index = await seedTask(source, "需要完成上线检查。", "进行中");
    const changed = "# 计划\n\n需要完成上线检查，今天就做。\n";
    const failing: ModelClient = async () => {
      throw new Error("连接中断");
    };
    const again = await analyzeDocument({
      index,
      relativePath: "notes.md",
      text: changed,
      now: "2026-09-27T13:00:00.000Z",
      complete: failing,
      createId: ids(),
    });
    expect(again.index.files[0].segments[0].task?.status).toBe("进行中");
    expect(again.index.files[0].segments[0].tags).toEqual(["立项计划"]);
    expect(again.messages.join("")).toContain("没有更新");
    expect(again.index.files[0].processedContentHash).toBe(contentHash(source));
  });

  it("AN-10 内容哈希相同则不受段序调换影响", async () => {
    const source = "# 文档\n\n甲段原文保持。\n\n乙段原文保持。\n";
    const seeded = await analyzeWith(
      source,
      client((text) => ({ tags: [text.includes("甲") ? "立项计划" : "产品调研"], task: null })).complete,
      emptyIndex(),
      "notes.md",
      10,
    );
    const swapped = "# 文档\n\n乙段原文保持。\n\n甲段原文保持。\n";
    const stub = client(() => ({ tags: ["不该调用"], task: null }));
    const again = await analyzeWith(swapped, stub.complete, seeded.index, "notes.md", 10);
    expect(stub.calls).toHaveLength(0);
    const tagged = again.index.files[0].segments.map((segment) => [segment.text, segment.tags[0]]);
    expect(tagged).toContainEqual(["乙段原文保持。", "产品调研"]);
    expect(tagged).toContainEqual(["甲段原文保持。", "立项计划"]);
  });

  it("TG-01 超过两个标签的结果不写入", async () => {
    const result = await analyzeWith(
      "# 计划\n\n一段说明。\n",
      client(() => ({ tags: ["一", "二", "三"], task: null })).complete,
    );
    expect(result.index.files[0].segments[0].tags.length).toBeLessThanOrEqual(2);
    expect(result.index.files[0].segments[0].tags).not.toEqual(["一", "二", "三"]);
    expect(result.messages.join("")).toContain("没有更新");
  });

  it("TG-02 手改标签不能超过两个", async () => {
    const result = await analyzeWith("# 计划\n\n一段说明。\n", client(() => ({ tags: ["立项计划", "产品调研"], task: null })).complete);
    const segment = result.index.files[0].segments[0];
    const updated = updateSegmentTags(result.index, "notes.md", segment.headingPath, segment.ordinal, ["立项计划", "产品调研", "技术设计"]);
    expect(updated.ok).toBe(false);
    expect(updated.index.files[0].segments[0].tags).toEqual(["立项计划", "产品调研"]);
  });

  it("TG-03 请求附上固定阶段", async () => {
    const existing = await analyzeWith("# 旧文\n\n已有内容。\n", client(() => ({ tags: ["立项计划"], task: null })).complete);
    existing.index.files[0].segments[0].tags = ["上线"];
    const stub = client(() => ({ tags: ["立项计划"], task: null }));
    await analyzeWith("# 新文\n\n另一段内容。\n", stub.complete, existing.index, "next.md");
    expect(stub.calls[0].projectTags).toEqual([...STAGE_TAGS]);
    expect(stub.calls[0].projectTags).not.toContain("上线");
  });

  it("TG-03 选中文件夹时请求不带另一文件夹的旧说法", async () => {
    const index = emptyIndex();
    index.files.push(fileWith("调研/a.md", "已有内容。", null, ["立项计划"]));
    index.files.push(fileWith("别处/b.md", "另一边。", null, ["旧说法"]));
    const stub = client(() => ({ tags: ["立项计划"], task: null }));
    const result = await analyzeDocument({
      index,
      relativePath: "调研/c.md",
      text: "# 新文\n\n另一段内容。\n",
      now: "2026-09-28T00:00:00.000Z",
      complete: stub.complete,
      scope: { kind: "folder", path: "调研" },
    });
    expect(stub.calls[0].projectTags).toEqual([...STAGE_TAGS]);
    expect(stub.calls[0].projectTags).not.toContain("旧说法");
    expect(result.requests[0].projectTags).not.toContain("旧说法");
  });

  it("TG-04 正文未变时非阶段手改仍然保留", async () => {
    const source = "# 计划\n\n一段说明。\n";
    const seeded = await analyzeWith(source, client(() => ({ tags: ["立项计划"], task: null })).complete);
    seeded.index.files[0].segments[0].tags = ["上线"];
    seeded.index.files[0].segments[0].tagsUserEdited = true;
    const stub = client(() => ({ tags: ["技术实现"], task: null }));
    const again = await analyzeWith(source, stub.complete, seeded.index);
    expect(stub.calls).toHaveLength(0);
    expect(again.index.files[0].segments[0].tags).toEqual(["上线"]);
  });

  it("TG-05 词表外说法不写入", async () => {
    const source = "# 计划\n\n一段说明。\n";
    const seeded = await analyzeWith(source, client(() => ({ tags: ["立项计划"], task: null })).complete);
    const changed = "# 计划\n\n一段说明改了。\n";
    const result = await analyzeWith(changed, client(() => ({ tags: ["上线"], task: null })).complete, seeded.index);
    expect(result.index.files[0].segments[0].tags).toEqual(["立项计划"]);
    expect(result.messages.join("")).toContain("没有更新");
  });

  it("TG-06 手改只能选择固定阶段", async () => {
    const result = await analyzeWith("# 计划\n\n一段说明。\n", client(() => ({ tags: ["立项计划"], task: null })).complete);
    const segment = result.index.files[0].segments[0];
    const rejected = updateSegmentTags(result.index, "notes.md", segment.headingPath, segment.ordinal, ["立项计划", "上线"]);
    expect(rejected.ok).toBe(false);
    expect(rejected.index.files[0].segments[0].tags).toEqual(["立项计划"]);
    const added = updateSegmentTags(result.index, "notes.md", segment.headingPath, segment.ordinal, ["立项计划", "技术实现"]);
    expect(added.ok).toBe(true);
    expect(added.index.files[0].segments[0].tags).toEqual(["立项计划", "技术实现"]);
    const planted = structuredClone(result.index);
    planted.files[0].segments[0].tags = ["上线"];
    const removed = updateSegmentTags(planted, "notes.md", segment.headingPath, segment.ordinal, []);
    expect(removed.ok).toBe(true);
    expect(removed.index.files[0].segments[0].tags).toEqual([]);
  });

  it("TK-01 一段不会保存两条任务", async () => {
    const raw = JSON.stringify({
      tags: ["技术实现"],
      task: [
        { summary: "一", quote: "一段说明。", status: "待确认", reason: "a" },
        { summary: "二", quote: "一段说明。", status: "待确认", reason: "b" },
      ],
    });
    expect(parseModelPayload(JSON.parse(raw)).ok).toBe(false);
    const result = await analyzeWith("# 计划\n\n一段说明。\n", async () => {
      throw new Error("一段最多一条任务");
    });
    expect(result.index.files[0].segments[0].task).toBeNull();
  });

  it("TK-06 摘录不在正文中时不写入任务", async () => {
    const seeded = await seedTask("# 计划\n\n需要完成上线检查。\n", "需要完成上线检查。", "进行中");
    const changed = "# 计划\n\n需要完成上线检查，并记录结果。\n";
    const result = await analyzeWith(
      changed,
      client(() => ({ tags: ["上线运营"], task: task("已完成", "这段话根本不存在") })).complete,
      seeded,
    );
    expect(result.index.files[0].segments[0].task?.status).toBe("进行中");
    expect(result.messages.join("")).toContain("没有更新");
  });

  it("SR-01 至 SR-04 按标签和状态筛选并保持原文顺序", async () => {
    const source = "# 计划\n\n甲要上线。\n\n乙已经上线。\n\n丙只是背景。\n";
    const result = await analyzeWith(
      source,
      client((text) => {
        if (text.includes("甲")) return { tags: ["上线运营"], task: task("进行中", "甲要上线。") };
        if (text.includes("乙")) return { tags: ["上线运营"], task: task("已完成", "乙已经上线。") };
        return { tags: ["立项计划"], task: null };
      }).complete,
      emptyIndex(),
      "notes.md",
      8,
    );
    const byTag = searchHits(result.index, { tag: "上线运营" });
    expect(byTag.map((hit) => hit.text)).toEqual(["甲要上线。", "乙已经上线。"]);
    expect(byTag[1].neighbors.map((item) => item.text)).toEqual(["甲要上线。", "丙只是背景。"]);
    expect(searchHits(result.index, { status: "进行中" }).map((hit) => hit.text)).toEqual(["甲要上线。"]);
    expect(searchHits(result.index, { tag: "上线运营", status: "已完成" }).map((hit) => hit.text)).toEqual(["乙已经上线。"]);
    expect(searchHits(result.index, { status: "待确认" })).toHaveLength(0);
  });

  it("SR-01 至 SR-04 选中文件或文件夹时不越过路径前缀", () => {
    const index: ProjectIndex = {
      version: 1,
      files: [
        fileWith("note/a.md", "甲要上线。", "进行中"),
        fileWith("notebook/b.md", "乙已经上线。", "已完成"),
        fileWith("note/nested/c.md", "丙也要上线。", "待确认"),
      ],
      unmatched: [],
    };
    const folder = searchHits(index, { tag: "上线运营" }, { kind: "folder", path: "note" });
    expect(folder.map((hit) => hit.text)).toEqual(["甲要上线。", "丙也要上线。"]);
    expect(searchHits(index, { status: "进行中" }, { kind: "folder", path: "note" }).map((hit) => hit.text)).toEqual(["甲要上线。"]);
    expect(searchHits(index, { tag: "上线运营", status: "已完成" }, { kind: "file", path: "notebook/b.md" }).map((hit) => hit.text)).toEqual(["乙已经上线。"]);
    expect(searchHits(index, { tag: "上线运营" }, { kind: "file", path: "note/a.md" }).map((hit) => hit.path)).toEqual(["note/a.md"]);
    expect(searchHits(index, { tag: "上线运营" }).map((hit) => hit.text)).toEqual(["甲要上线。", "丙也要上线。", "乙已经上线。"]);
  });

  it("FL 改名保留身份，删除清除，导出只有正文", async () => {
    const source = "# 计划\n\n需要完成上线检查。\n";
    const index = await seedTask(source, "需要完成上线检查。");
    const renamed = renameIndexedFile(index, "notes.md", "renamed.md");
    expect(renamed.files[0].id).toBe(index.files[0].id);
    expect(renamed.files[0].segments[0].tags).toEqual(["立项计划"]);
    expect(() => renameIndexedFile(index, "notes.md", "other/notes.md")).toThrow("不支持移动文件");
    const removed = removeIndexedFile(renamed, "renamed.md");
    expect(removed.files).toHaveLength(0);
    expect(removed.unmatched).toHaveLength(0);
    const { exportDocument } = await import("../src/core/analyze");
    expect(exportDocument(source)).toBe(source);
    expect(exportDocument(source)).not.toContain(index.files[0].id);
  });

  it("AN-05 再次分析不会复制未匹配，关闭后不再出现", async () => {
    const source = "# 计划\n\n需要完成上线检查。\n";
    const index = await seedTask(source, "需要完成上线检查。");
    const stub = client(() => ({ tags: [], task: null }));
    const first = await analyzeWith("# 备注\n\n只剩背景。\n", stub.complete, index);
    const second = await analyzeWith("# 备注\n\n只剩背景。\n", stub.complete, first.index);
    expect(second.index.unmatched).toHaveLength(1);
    const dismissed = dismissUnmatched(second.index, second.index.unmatched[0].id);
    const third = await analyzeWith("# 备注\n\n只剩背景。\n", stub.complete, dismissed);
    expect(third.index.unmatched).toHaveLength(0);
  });
});

type ModelClient = Parameters<typeof analyzeDocument>[0]["complete"];

describe("模型输出", () => {
  it("AI-03 非法状态和多余字段被拒绝", () => {
    const extra = parseModelPayload({
      tags: ["范围"],
      task: { summary: "做", quote: "正文", status: "未完成", reason: "因为" },
      extra: true,
    });
    expect(extra.ok).toBe(false);
    const status = parseModelPayload({
      tags: ["范围"],
      task: { summary: "做", quote: "正文", status: "未完成", reason: "因为" },
    });
    expect(status.ok).toBe(false);
  });

  it("AI-01 与 AI-02 请求发往指定的兼容地址", async () => {
    const seen: { url: string; authorization: string; body: string }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      seen.push({
        url: String(url),
        authorization: (init?.headers as Record<string, string>).Authorization,
        body: String(init?.body),
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ tags: ["立项计划"], task: null }) } }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const local = createOpenAIClient({
        baseUrl: "http://localhost:11434/v1",
        apiKey: "ollama",
        model: "llama3.2",
      });
      await local({ segmentText: "正文", headingPath: "计划", projectTags: ["上线"], previous: null });
      const cloud = createOpenAIClient({
        baseUrl: "https://example.test/v1/",
        apiKey: "secret",
        model: "other",
      });
      await cloud({ segmentText: "正文", headingPath: "计划", projectTags: [], previous: null });
    } finally {
      globalThis.fetch = original;
    }
    expect(seen[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(seen[0].authorization).toBe("Bearer ollama");
    expect(seen[0].body).toContain("可选阶段：立项计划、产品调研");
    expect(seen[0].body).toContain("项目复盘");
    expect(seen[0].body).not.toContain("项目已有标签");
    expect(seen[1].url).toBe("https://example.test/v1/chat/completions");
    expect(seen[1].authorization).toBe("Bearer secret");
  });

  it("TK-07 请求只收本段未完成事项", async () => {
    const body = await captureCompletionBody("登录还没做完。");
    expect(body).toContain("只能从用户消息里的可选阶段中选择");
    expect(body).toContain("只有这段里还没做完的事项才建任务");
    expect(body).toContain("原文已写明解决、完成或修好时，任务为空，不要收成「已完成」");
    expect(body).toContain("原文已写明放弃、取消或不做时，任务为空");
    expect(body).toContain("不要根据同一文档的其他段判断");
    expect(body).toContain("登录还没做完。");
  });

  it("TK-08 未完成事项的建议状态", async () => {
    const body = await captureCompletionBody("接口还在改。");
    expect(body).toContain("正在做、未完成或执行中建议「进行中」");
    expect(body).toContain("只是待办、没有写做到哪一步建议「待确认」");
    expect(body).toContain("不要把这类未完成事项标成「已完成」或「已取消」");
  });

  it("连接失败时说明打到了哪个接口", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("Load failed");
    }) as typeof fetch;
    try {
      const local = createOpenAIClient({
        baseUrl: "http://localhost:11434/v1",
        apiKey: "ollama",
        model: "llama3.2",
      });
      await expect(
        local({ segmentText: "正文", headingPath: "Lumina开发", projectTags: [], previous: null }),
      ).rejects.toThrow("连不上模型接口 http://localhost:11434/v1/chat/completions");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("同一标题的连接失败只提示一次", async () => {
    let calls = 0;
    const result = await analyzeDocument({
      index: emptyIndex(),
      relativePath: "notes/idea.md",
      text: "# Lumina开发\n\n- 金句可以自动生成。\n- 划线要容易操作。\n",
      now: "2026-09-28T01:00:00.000Z",
      complete: async () => {
        calls += 1;
        throw new ModelTransportError("连不上模型接口 http://localhost:11434/v1/chat/completions：请求没有到达");
      },
      createId: ids(),
    });
    expect(calls).toBe(1);
    expect(result.messages).toEqual([
      "Lumina开发没有更新：连不上模型接口 http://localhost:11434/v1/chat/completions：请求没有到达",
    ]);
    expect(result.index.files[0].segments).toHaveLength(2);
    expect(result.index.files[0].segments.every((segment) => segment.pendingModel)).toBe(true);
    expect(result.index.files[0].processedContentHash).toBeNull();
  });
});

function fileWith(path: string, text: string, status: TaskStatus | null, tags = ["上线运营"]): FileRecord {
  return {
    id: path,
    path,
    processedContentHash: "hash",
    segments: [{
      headingPath: ["计划"],
      ordinal: 0,
      start: 0,
      end: text.length,
      text,
      contentHash: "hash",
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
      processedAt: "2026-09-28T00:00:00.000Z",
      tags,
      tagsUserEdited: false,
      task: status
        ? { summary: text, quote: text, status, reason: "测试", userEdited: false }
        : null,
      pendingModel: false,
    }],
  };
}

async function captureCompletionBody(segmentText: string): Promise<string> {
  const original = globalThis.fetch;
  let body = "";
  globalThis.fetch = (async (_url, init) => {
    body = String(init?.body);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ tags: [], task: null }) } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const client = createOpenAIClient({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
      model: "llama3.2",
    });
    await client({ segmentText, headingPath: "计划", projectTags: ["上线"], previous: null });
  } finally {
    globalThis.fetch = original;
  }
  return body;
}
