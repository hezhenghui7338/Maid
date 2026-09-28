/**
 * @vitest-environment jsdom
 */
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/App";
import { STAGE_TAGS } from "../src/core/stages";

const FILE = "notes/idea.md";
const SOURCE = "# 立项\n\n需要完成上线检查。\n\n## 范围\n\n- 写出测试\n- 修好新建\n";

const memory = vi.hoisted(() => {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  let selection: { kind: "folder" | "file"; path: string } | null = null;

  function child(parent: string, name: string) {
    return parent ? `${parent}/${name}` : name;
  }

  function nodes() {
    const listed = [
      ...[...folders].map((path) => ({ path, kind: "folder" as const })),
      ...[...files.keys()]
        .filter((path) => !path.split("/").some((part) => part.startsWith(".")) && /\.(md|markdown)$/i.test(path))
        .map((path) => ({ path, kind: "file" as const })),
    ];
    listed.sort((left, right) => left.path.localeCompare(right.path, "zh"));
    return listed;
  }

  return {
    queuedImport: null as { name: string; content: string } | null,
    lastExport: null as { name: string; content: string } | null,
    selection,
    reset() {
      files.clear();
      folders.clear();
      selection = null;
      this.selection = null;
      this.queuedImport = null;
      this.lastExport = null;
    },
    async session() {
      return { selection: this.selection, warnings: [] as string[] };
    },
    async rememberSelection(kind: "folder" | "file", path: string) {
      selection = { kind, path };
      this.selection = selection;
    },
    async listTree() {
      return nodes();
    },
    async createFolder(parent: string, name: string) {
      const trimmed = name.trim();
      if (!trimmed || trimmed.includes("/") || trimmed.startsWith(".")) throw new Error("名称无效");
      const path = child(parent, trimmed);
      if (folders.has(path) || files.has(path)) throw new Error("已存在");
      folders.add(path);
      return path;
    },
    async createFile(parent: string, name: string) {
      const trimmed = name.trim();
      const fileName = /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
      const path = child(parent, fileName);
      if (files.has(path)) throw new Error("已存在");
      files.set(path, "# \n\n");
      return path;
    },
    async readText(relativePath: string) {
      const text = files.get(relativePath);
      if (text === undefined) throw new Error("找不到文件");
      return text;
    },
    async writeText(relativePath: string, content: string) {
      files.set(relativePath, content);
    },
    async removePath(relativePath: string) {
      files.delete(relativePath);
      folders.delete(relativePath);
      for (const path of [...files.keys()]) {
        if (path.startsWith(`${relativePath}/`)) files.delete(path);
      }
      for (const path of [...folders]) {
        if (path.startsWith(`${relativePath}/`)) folders.delete(path);
      }
    },
    async renamePath(from: string, name: string) {
      const parent = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
      const renamed = folders.has(from) && !files.has(from)
        ? name.trim()
        : (/\.(md|markdown)$/i.test(name.trim()) ? name.trim() : `${name.trim()}.md`);
      const to = child(parent, renamed);
      if (files.has(from)) {
        files.set(to, files.get(from) ?? "");
        files.delete(from);
      }
      for (const path of [...files.keys()]) {
        if (path.startsWith(`${from}/`)) {
          files.set(`${to}/${path.slice(from.length + 1)}`, files.get(path) ?? "");
          files.delete(path);
        }
      }
      const nextFolders = new Set<string>();
      for (const path of folders) {
        if (path === from) nextFolders.add(to);
        else if (path.startsWith(`${from}/`)) nextFolders.add(`${to}/${path.slice(from.length + 1)}`);
        else nextFolders.add(path);
      }
      folders.clear();
      for (const path of nextFolders) folders.add(path);
      return to;
    },
    async importMarkdown(parent: string) {
      const queued = this.queuedImport;
      this.queuedImport = null;
      if (!queued) return [] as string[];
      const path = child(parent, queued.name);
      files.set(path, queued.content);
      return [path];
    },
    async exportText(defaultName: string, content: string) {
      this.lastExport = { name: defaultName, content };
      return true;
    },
  };
});

vi.mock("../src/host", () => ({
  inTauri: () => true,
  host: memory,
}));

describe("界面故事", () => {
  beforeAll(() => {
    const rect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 16,
      right: 120,
      width: 120,
      height: 16,
      toJSON() {
        return {};
      },
    };
    const rects = {
      item: () => rect,
      length: 1,
      *[Symbol.iterator]() {
        yield rect;
      },
    } as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => rect;
    Range.prototype.getClientRects = () => rects;
    Element.prototype.getClientRects = () => rects;
    document.elementFromPoint = () => null;
  });

  beforeEach(() => {
    memory.reset();
    installModel();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ED-06 没有新建项目，文件夹出现在存储文件树里", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole("button", { name: "新建项目" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "项目" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "新建" }));
    await user.click(await screen.findByRole("menuitem", { name: "新建文件夹" }));
    const dialog = await screen.findByRole("dialog", { name: "新建文件夹" });
    await user.type(within(dialog).getByRole("textbox", { name: "名称" }), "立项");
    await user.click(within(dialog).getByRole("button", { name: "确定" }));
    expect(await screen.findByRole("button", { name: "立项" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("创建新文件后文件树里能打开这篇 Markdown", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "新建" });
    expect(screen.queryByRole("button", { name: "新建项目" })).toBeNull();
    for (const name of ["导入", "改名", "删除", "导出"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    await createIdeaFile(user);

    expect(await screen.findByRole("button", { name: FILE })).toBeTruthy();
    expect(await memory.readText(FILE)).toBe("# \n\n");
    expect(document.querySelector(".preview")).toBeNull();
    expect(screen.queryByRole("button", { name: /源码/ })).toBeNull();
    const opened = editorView();
    expect(opened.state.doc.toString()).toBe("# \n\n");
  });

  it("八类语法在同一屏按语义出现，输入会改动正文", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    const sample = [
      "# 标题",
      "",
      "一段 **强调** 与 [链接](https://example.com)。",
      "",
      "- 列表",
      "",
      "> 引用",
      "",
      "```",
      "code",
      "```",
      "",
      "| 甲 | 乙 |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
    ].join("\n");
    replaceEditor(sample);
    const view = editorView();
    expect(view.state.doc.toString()).toBe(sample);
    const editor = document.querySelector(".cm-editor");
    if (!editor) throw new Error("编辑器没有出现");
    await waitFor(() => {
      expect(editor.querySelector(".md-heading")).toBeTruthy();
      expect(editor.querySelector(".md-paragraph")).toBeTruthy();
      expect(editor.querySelector(".md-list")).toBeTruthy();
      expect(editor.querySelector(".md-quote")).toBeTruthy();
      expect(editor.querySelector(".md-code")).toBeTruthy();
      expect(editor.querySelector(".md-table")).toBeTruthy();
      expect(editor.querySelector(".md-link")).toBeTruthy();
      expect(editor.querySelector(".md-strong")).toBeTruthy();
    });
    view.dispatch({ selection: { anchor: sample.indexOf("一段") } });
    await waitFor(() => {
      expect(editor.textContent).not.toContain("#");
      expect(editor.textContent).not.toContain("**");
      expect(editor.textContent).toContain("强调");
      expect(editor.textContent).toContain("链接");
      expect(editor.textContent).not.toContain("https://example.com");
    });
    const strong = sample.indexOf("强调");
    view.dispatch({ selection: { anchor: strong } });
    await waitFor(() => {
      expect(editor.textContent).toContain("**");
    });
    view.dispatch({ changes: { from: view.state.doc.length, insert: "补一句。" } });
    expect(view.state.doc.toString()).toContain("补一句。");
    expect(document.querySelector(".preview")).toBeNull();
    expect(screen.queryByRole("button", { name: /源码/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "分析" }));
    expect(await memory.readText(FILE)).toContain("补一句。");
  });

  it("分析后按标题和清单分段并显示在段列表", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    replaceEditor(SOURCE);

    await user.click(screen.getByRole("button", { name: "分析" }));
    await openReview(user);

    expect((await screen.findAllByText(/立项 \/ 范围/)).length).toBeGreaterThanOrEqual(2);
    expect(segmentContaining("需要完成上线检查")).toBeTruthy();
    expect(segmentContaining("写出测试")).toBeTruthy();
    expect(screen.queryByText(/没有更新/)).toBeNull();
  });

  it("段上可以新增和删除标签且不能超过两个", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    replaceEditor(SOURCE);
    await user.click(screen.getByRole("button", { name: "分析" }));
    await openReview(user);
    await screen.findAllByText(/立项 \/ 范围/);

    const segment = segmentContaining("需要完成上线检查");
    await user.selectOptions(within(segment).getByRole("combobox", { name: "新增标签" }), "产品调研");
    await user.click(within(segment).getByRole("button", { name: "添加" }));
    const tagged = segmentContaining("需要完成上线检查");
    expect(within(tagged).getByRole("button", { name: "立项计划 ×" })).toBeTruthy();
    expect(within(tagged).getByRole("button", { name: "产品调研 ×" })).toBeTruthy();
    expect(within(tagged).getByText("完成上线检查").tagName).toBe("P");
    expect(within(tagged).queryByRole("textbox")).toBeNull();

    await user.selectOptions(within(tagged).getByRole("combobox", { name: "新增标签" }), "产品设计");
    await user.click(within(tagged).getByRole("button", { name: "添加" }));
    expect(screen.getByText("一段最多两个主题标签")).toBeTruthy();

    await user.click(within(segmentContaining("需要完成上线检查")).getByRole("button", { name: "立项计划 ×" }));
    const kept = segmentContaining("需要完成上线检查");
    expect(within(kept).queryByRole("button", { name: "立项计划 ×" })).toBeNull();
    expect(within(kept).getByRole("button", { name: "产品调研 ×" })).toBeTruthy();
  });

  it("任务状态可改为进行中并按状态筛选", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    replaceEditor(SOURCE);
    await user.click(screen.getByRole("button", { name: "分析" }));
    await openReview(user);
    await screen.findByText("完成上线检查");

    const segment = segmentContaining("需要完成上线检查");
    const status = within(segment).getByRole("combobox", { name: "任务状态" }) as HTMLSelectElement;
    expect(status.value).toBe("待确认");
    await user.selectOptions(status, "进行中");

    await user.selectOptions(screen.getByRole("combobox", { name: "状态" }), "进行中");
    const hit = await screen.findByRole("button", { name: /notes\/idea\.md · 立项/ });
    await user.click(hit);
    const editor = document.querySelector(".cm-editor");
    expect(editor?.querySelector(".cm-hit")?.textContent).toContain("需要完成上线检查");

    const stored = JSON.parse(await memory.readText(".maid/index.json")) as {
      files: { segments: { tags: string[]; task: { status: string } | null }[] }[];
    };
    const taskSegment = stored.files[0].segments.find((item) => item.task);
    expect(taskSegment?.task?.status).toBe("进行中");
    expect(taskSegment?.tags).toEqual(["立项计划"]);
  });

  it("检索高亮和列表回跳落在同一屏文档里", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    replaceEditor(SOURCE);
    await user.click(screen.getByRole("button", { name: "分析" }));
    await openReview(user);
    await screen.findAllByText(/立项 \/ 范围/);

    for (const snippet of ["需要完成上线检查", "写出测试"]) {
      const segment = segmentContaining(snippet);
      await user.selectOptions(within(segment).getByRole("combobox", { name: "新增标签" }), "上线运营");
      await user.click(within(segment).getByRole("button", { name: "添加" }));
    }
    await user.selectOptions(screen.getByRole("combobox", { name: "标签" }), "上线运营");
    const hits = await screen.findAllByRole("button", { name: /notes\/idea\.md ·/ });
    expect(hits.map((item) => item.textContent)).toEqual([
      expect.stringContaining("需要完成上线检查"),
      expect.stringContaining("写出测试"),
    ]);
    const scrollIntoView = vi.spyOn(EditorView, "scrollIntoView");
    await user.click(hits[1]);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    scrollIntoView.mockRestore();
    const editor = document.querySelector(".cm-editor");
    expect(editor?.querySelector(".cm-hit")?.textContent).toContain("写出测试");
    expect(editor?.querySelector(".cm-hit")?.textContent).not.toContain("修好新建");
    expect(editor?.querySelector(".cm-neighbor")).toBeTruthy();
    const stage = document.querySelector(".stage");
    if (!(stage instanceof HTMLElement)) throw new Error("写作屏没有出现");
    stage.focus();
    await user.keyboard("{ArrowUp}");
    await waitFor(() => {
      expect(document.querySelector(".cm-hit")?.textContent).toContain("需要完成上线检查");
    });
  });

  it("拉到文末再编辑时不会跳回开头", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    replaceEditor(`${SOURCE}\n${"# 后记\n\n仍在写这一段。\n".repeat(8)}`);
    await user.click(screen.getByRole("button", { name: "分析" }));
    await waitFor(async () => {
      const stored = JSON.parse(await memory.readText(".maid/index.json")) as { files: { path: string }[] };
      expect(stored.files.some((item) => item.path === FILE)).toBe(true);
    });

    const scrollIntoView = vi.spyOn(EditorView, "scrollIntoView");
    const view = editorView();
    const end = view.state.doc.length;
    view.dispatch({
      changes: { from: end, to: end, insert: "续。" },
      selection: { anchor: end + 2 },
    });
    await waitFor(() => {
      expect(screen.queryByText("需要重新分析")).toBeNull();
      expect(screen.getByText(FILE)).toBeTruthy();
      expect(view.state.selection.main.head).toBe(end + 2);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
    scrollIntoView.mockRestore();
  });

  it("写作屏不挂检索，整理列出未打开文件里的命中段", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    replaceEditor(SOURCE);
    await user.click(screen.getByRole("button", { name: "分析" }));

    await user.click(screen.getByRole("button", { name: "新建" }));
    await user.click(await screen.findByRole("menuitem", { name: "新建文件" }));
    const dialog = await screen.findByRole("dialog", { name: "新建文件" });
    await user.type(within(dialog).getByRole("textbox", { name: "名称" }), "other.md");
    await user.click(within(dialog).getByRole("button", { name: "确定" }));
    await screen.findByRole("button", { name: "notes/other.md" });
    replaceEditor("# 别的\n\n需要完成上线检查。\n");
    await user.click(screen.getByRole("button", { name: "分析" }));

    expect(screen.queryByRole("combobox", { name: "标签" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "任务状态" })).toBeNull();
    expect(document.querySelector(".cm-editor")).toBeTruthy();
    expect(screen.getByRole("button", { name: FILE })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "notes" }));

    await openReview(user);
    expect(document.querySelector(".cm-editor")).toBeNull();
    expect(document.querySelector(".review")).toBeTruthy();
    expect(screen.queryByRole("button", { name: FILE, exact: true })).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "标签" }), "立项计划");
    expect(await screen.findByRole("button", { name: /notes\/idea\.md/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /notes\/other\.md/ })).toBeTruthy();
  });

  it("SR-04 选中一篇文件时不列出另一篇的命中段", async () => {
    const user = userEvent.setup();
    const segment = {
      headingPath: ["计划"],
      ordinal: 0,
      start: 0,
      end: 4,
      text: "一段。",
      contentHash: "hash",
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
      processedAt: "2026-09-28T00:00:00.000Z",
      tags: ["立项计划"],
      tagsUserEdited: false,
      task: null,
      pendingModel: false,
    };
    await memory.writeText("one.md", "# 计划\n\n一段。\n");
    await memory.writeText("other.md", "# 计划\n\n另一段。\n");
    await memory.writeText(".maid/index.json", JSON.stringify({
      version: 1,
      files: [
        { id: "file-1", path: "one.md", processedContentHash: "hash", segments: [{ ...segment, text: "一段。" }] },
        { id: "file-2", path: "other.md", processedContentHash: "hash", segments: [{ ...segment, text: "另一段。" }] },
      ],
      unmatched: [],
    }));
    memory.selection = { kind: "file", path: "one.md" };
    render(<App />);
    await openReview(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "标签" }), "立项计划");
    expect(await screen.findByRole("button", { name: /one\.md/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /other\.md/ })).toBeNull();
  });

  it("SR-05 标签筛选项固定为九个阶段", async () => {
    const user = userEvent.setup();
    await memory.writeText(".maid/index.json", JSON.stringify({
      version: 1,
      files: [{
        id: "file-1",
        path: "notes.md",
        processedContentHash: null,
        segments: [{
          headingPath: ["计划"],
          ordinal: 0,
          start: 0,
          end: 3,
          text: "一段。",
          contentHash: "hash",
          createdAt: "2026-09-28T00:00:00.000Z",
          updatedAt: "2026-09-28T00:00:00.000Z",
          processedAt: "2026-09-28T00:00:00.000Z",
          tags: ["上线"],
          tagsUserEdited: false,
          task: null,
          pendingModel: false,
        }],
      }],
      unmatched: [],
    }));
    render(<App />);
    await openReview(user);
    const select = screen.getByRole("combobox", { name: "标签" }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual(["全部", ...STAGE_TAGS]);
    expect([...select.options].map((option) => option.value)).not.toContain("上线");
  });

  it("文件上的右键菜单有导入改名删除导出且没有移动", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);

    fireEvent.contextMenu(screen.getByRole("button", { name: FILE }));
    const menu = await screen.findByRole("menu", { name: "文件操作" });
    for (const name of ["导入", "改名", "删除", "导出"]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeTruthy();
    }
    expect(within(menu).queryByRole("menuitem", { name: "移动" })).toBeNull();

    await user.click(within(menu).getByRole("menuitem", { name: "改名" }));
    const rename = await screen.findByRole("dialog", { name: "修改文件名" });
    const nameInput = within(rename).getByRole("textbox", { name: "新的名称，仍在当前目录" });
    await user.clear(nameInput);
    await user.type(nameInput, "renamed.md");
    await user.click(within(rename).getByRole("button", { name: "确定" }));
    expect(await screen.findByRole("button", { name: "notes/renamed.md" })).toBeTruthy();

    fireEvent.contextMenu(screen.getByRole("button", { name: "notes/renamed.md" }));
    await user.click(within(await screen.findByRole("menu", { name: "文件操作" })).getByRole("menuitem", { name: "删除" }));
    const confirm = await screen.findByRole("dialog", { name: "删除文件" });
    await user.click(within(confirm).getByRole("button", { name: "删除" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "notes/renamed.md" })).toBeNull();
    });
    expect(screen.getByText("未打开文件")).toBeTruthy();
  });

  it("空白文件栏右键可以导入", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    const pane = document.querySelector(".files");
    if (!pane) throw new Error("文件栏没有出现");
    fireEvent.contextMenu(pane);
    const menu = await screen.findByRole("menu", { name: "文件操作" });
    expect(within(menu).getByRole("menuitem", { name: "导入" })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "改名" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "移动" })).toBeNull();
    memory.queuedImport = { name: "external.md", content: "外部正文" };
    await user.click(within(menu).getByRole("menuitem", { name: "导入" }));
    expect(await screen.findByRole("button", { name: "external.md" })).toBeTruthy();
    expect(await memory.readText("external.md")).toBe("外部正文");
  });

  it("右键未打开的文件导出时不带入另一份草稿", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    await user.click(screen.getByRole("button", { name: "新建" }));
    await user.click(await screen.findByRole("menuitem", { name: "新建文件" }));
    const dialog = await screen.findByRole("dialog", { name: "新建文件" });
    await user.type(within(dialog).getByRole("textbox", { name: "名称" }), "other.md");
    await user.click(within(dialog).getByRole("button", { name: "确定" }));
    await screen.findByRole("button", { name: "notes/other.md" });
    replaceEditor("未保存草稿\n");
    await waitFor(() => {
      expect(editorView().state.doc.toString()).toContain("未保存草稿");
      expect(screen.queryByText("需要重新分析")).toBeNull();
      expect(screen.getByText("notes/other.md")).toBeTruthy();
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: FILE }));
    const menu = await screen.findByRole("menu", { name: "文件操作" });
    await user.click(within(menu).getByRole("menuitem", { name: "导出" }));
    await waitFor(() => {
      expect(memory.lastExport?.content).toBe("# \n\n");
    });
    expect(memory.lastExport?.content).not.toContain("未保存草稿");
  });

  it("AN-08 过期后不显示重新分析也不沿用旧高亮", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    replaceEditor(SOURCE);
    await user.click(screen.getByRole("button", { name: "分析" }));
    await openReview(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "标签" }), "立项计划");
    const hit = await screen.findByRole("button", { name: /notes\/idea\.md · 立项/ });
    await user.click(hit);
    await waitFor(() => {
      expect(document.querySelector(".cm-hit")?.textContent).toContain("需要完成上线检查");
    });

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, to: view.state.doc.length, insert: "改了。" } });
    await waitFor(() => {
      expect(document.querySelector(".cm-hit")).toBeNull();
    });
    expect(screen.queryByText("需要重新分析")).toBeNull();
    expect(screen.getByText(FILE)).toBeTruthy();
  });

  it("AI-05 底栏不展示当前模型与接口地址", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "API 设置" }));
    const base = screen.getByRole("textbox", { name: "接口地址" });
    const key = screen.getByLabelText("API 密钥");
    const model = screen.getByRole("textbox", { name: "模型名称" });
    await user.clear(base);
    await user.type(base, "https://models.example/v1");
    await user.clear(key);
    await user.type(key, "secret-key");
    await user.clear(model);
    await user.type(model, "example-model");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("API 设置已保存");

    await createNamedProject(user);
    await createIdeaFile(user);
    expect(screen.getByText(FILE)).toBeTruthy();
    expect(screen.queryByText("example-model")).toBeNull();
    expect(screen.queryByText("https://models.example/v1")).toBeNull();

    await user.click(screen.getByRole("button", { name: "API 设置" }));
    expect((screen.getByRole("textbox", { name: "接口地址" }) as HTMLInputElement).value).toBe("https://models.example/v1");
    expect((screen.getByLabelText("API 密钥") as HTMLInputElement).value).toBe("secret-key");
    expect((screen.getByRole("textbox", { name: "模型名称" }) as HTMLInputElement).value).toBe("example-model");
  });

  it("ED-07 写作屏可在整篇与按段之间切换", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    const sample = "# 立项\n\n第一段说明。\n\n## 范围\n\n第二段说明。\n";
    replaceEditor(sample);
    await user.click(screen.getByRole("button", { name: "按段" }));
    expect(await screen.findByText("立项 / 范围")).toBeTruthy();
    await waitFor(() => {
      const editors = [...document.querySelectorAll(".segment-edit .cm-editor")];
      expect(editors.length).toBeGreaterThan(1);
      expect(editors.some((editor) => editor.textContent?.includes("第一段说明"))).toBe(true);
      expect(editors.some((editor) => editor.textContent?.includes("第二段说明"))).toBe(true);
      expect(editors.some((editor) => editor.querySelector(".md-paragraph"))).toBe(true);
    });
    expect(document.querySelector(".preview")).toBeNull();
    expect(screen.queryByRole("button", { name: /源码/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "整篇" }));
    await waitFor(() => {
      expect(document.querySelector(".segment-edit")).toBeNull();
      expect(editorView().state.doc.toString()).toBe(sample);
    });
  });

  it("ED-08 按段编辑写回同一份 Markdown", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    const sample = "# 立项\n\n第一段说明。\n\n## 范围\n\n第二段说明。\n";
    replaceEditor(sample);
    await user.click(screen.getByRole("button", { name: "按段" }));
    await screen.findByText("立项");
    replaceSegment("第一段说明。", "第一段改过。");
    await user.click(screen.getByRole("button", { name: "整篇" }));
    await waitFor(() => {
      expect(editorView().state.doc.toString()).toContain("第一段改过。");
    });
    await user.click(screen.getByRole("button", { name: "分析" }));
    await waitFor(async () => {
      const saved = await memory.readText(FILE);
      expect(saved).toContain("第一段改过。");
      expect(saved).not.toContain("立项计划");
      expect(saved).not.toContain("<!--");
    });
  });

  it("AN-12 按段分析只请求所选段", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createNamedProject(user);
    await createIdeaFile(user);
    replaceEditor("# 甲\n\n甲段原来的句子。\n\n# 乙\n\n乙段原来的句子。\n");
    await user.click(screen.getByRole("button", { name: "分析" }));
    await waitFor(() => {
      expect(fetchMock().mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    await user.click(screen.getByRole("button", { name: "按段" }));
    await screen.findByText("乙");
    replaceSegment("甲段原来的句子。", "甲段改过的句子。");
    replaceSegment("乙段原来的句子。", "乙段改过的句子。");
    const before = fetchMock().mock.calls.length;
    const card = screen.getByText("甲").closest("article");
    if (!card) throw new Error("找不到甲");
    await user.click(within(card).getByRole("button", { name: "分析这段" }));
    await waitFor(() => {
      expect(fetchMock().mock.calls.length).toBe(before + 1);
    });
    const body = String(fetchMock().mock.calls.at(-1)?.[1] && (fetchMock().mock.calls.at(-1)?.[1] as RequestInit).body);
    expect(body).toContain("甲段改过的句子");
    expect(body).not.toContain("乙段改过的句子");
  });
});

async function createNamedProject(_user: UserEvent) {
  await screen.findByRole("button", { name: "新建" });
  expect(screen.queryByRole("button", { name: "新建项目" })).toBeNull();
}

async function createIdeaFile(user: UserEvent) {
  await user.click(await screen.findByRole("button", { name: "新建" }));
  await user.click(await screen.findByRole("menuitem", { name: "新建文件夹" }));
  let dialog = await screen.findByRole("dialog", { name: "新建文件夹" });
  await user.type(within(dialog).getByRole("textbox", { name: "名称" }), "notes");
  await user.click(within(dialog).getByRole("button", { name: "确定" }));
  await user.click(await screen.findByRole("button", { name: "notes" }));
  await user.click(screen.getByRole("button", { name: "新建" }));
  await user.click(await screen.findByRole("menuitem", { name: "新建文件" }));
  dialog = await screen.findByRole("dialog", { name: "新建文件" });
  await user.type(within(dialog).getByRole("textbox", { name: "名称" }), "idea.md");
  await user.click(within(dialog).getByRole("button", { name: "确定" }));
  await screen.findByRole("button", { name: FILE });
  await waitFor(() => {
    expect(document.querySelector(".cm-editor")).toBeTruthy();
  });
}

function editorView() {
  const editor = document.querySelector(".cm-editor");
  if (!editor) throw new Error("编辑器没有出现");
  return EditorView.findFromDOM(editor);
}

function replaceSegment(snippet: string, next: string) {
  const view = [...document.querySelectorAll(".cm-editor")]
    .map((editor) => EditorView.findFromDOM(editor))
    .find((item) => item.state.doc.toString().includes(snippet));
  if (!view) throw new Error(`找不到包含「${snippet}」的段`);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
}

function fetchMock() {
  return fetch as unknown as { mock: { calls: [unknown, RequestInit?][] } };
}

function replaceEditor(source: string) {
  const view = editorView();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
}

async function openReview(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "整理" }));
  await screen.findByRole("heading", { name: "整理" });
}

async function addStage(user: UserEvent, segment: HTMLElement, stage: string) {
  await user.selectOptions(within(segment).getByRole("combobox", { name: "新增标签" }), stage);
  await user.click(within(segment).getByRole("button", { name: "添加" }));
}

function segmentContaining(snippet: string): HTMLElement {
  const node = screen.getAllByText((_, element) => {
    return Boolean(element?.classList.contains("excerpt") && element.textContent?.includes(snippet));
  })[0];
  const segment = node?.closest(".segment");
  if (!segment) throw new Error(`找不到包含「${snippet}」的段`);
  return segment as HTMLElement;
}

function installModel() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: { content?: string }[] };
      const segment = body.messages?.at(-1)?.content?.split("段正文：\n").at(-1) ?? "";
      const payload = segment.includes("需要完成上线检查")
        ? {
            tags: ["立项计划"],
            task: {
              summary: "完成上线检查",
              quote: "需要完成上线检查。",
              status: "待确认",
              reason: "正文提出了要做的事",
            },
          }
        : segment.includes("写出测试")
          ? { tags: ["技术实现"], task: null }
          : { tags: ["项目复盘"], task: null };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}
