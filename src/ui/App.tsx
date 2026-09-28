import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeDocument,
  dismissUnmatched,
  exportDocument,
  isFileStale,
  parentPath,
  removeIndexedFile,
  renameIndexedFile,
  pathInScope,
  searchHits,
  updateSegmentTags,
  updateTaskStatus,
  type SearchScope,
} from "../core/analyze";
import { createOpenAIClient } from "../core/model";
import { segmentMarkdown, type SegmentDraft } from "../core/segment";
import { STAGE_TAGS } from "../core/stages";
import {
  defaultSettings,
  emptyIndex,
  formatHeadingPath,
  TASK_STATUSES,
  type ProjectIndex,
  type Settings,
  type TaskStatus,
} from "../core/types";
import { host, inTauri, type Selection, type TreeNode } from "../host";
import { SourceEditor, type EditorHandle, type HighlightRange } from "./editor";

const INDEX_PATH = ".maid/index.json";

export function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [writeView, setWriteView] = useState<"whole" | "segments">("whole");
  const [segmentCuts, setSegmentCuts] = useState<SegmentDraft[]>([]);
  const [index, setIndex] = useState<ProjectIndex>(emptyIndex());
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [screen, setScreen] = useState<"write" | "review">("write");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState("");
  const [hitIndex, setHitIndex] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<TextDialog | ConfirmDialog | null>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [menu, setMenu] = useState<FileMenu | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const dialogResolver = useRef<((value: string | null) => void) | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle>(null);
  const draftRef = useRef(draft);
  const segmentCutsRef = useRef(segmentCuts);
  const pathRef = useRef(path);
  const selectionRef = useRef(selection);
  draftRef.current = draft;
  segmentCutsRef.current = segmentCuts;
  pathRef.current = path;
  selectionRef.current = selection;

  const file = index.files.find((item) => item.path === path);
  const stale = path ? isFileStale(file, draft) : false;
  const scope = useMemo<SearchScope>(() => selection ?? { kind: "root" }, [selection]);
  const hits = useMemo(
    () => searchHits(index, { tag: tag || undefined, status: (status || undefined) as TaskStatus | undefined }, scope),
    [index, tag, status, scope],
  );
  const activeHit = hits[hitIndex];
  const highlights = useMemo<HighlightRange[]>(() => {
    if (!path || stale || !activeHit || activeHit.path !== path) return [];
    const ranges: HighlightRange[] = [{ from: activeHit.start, to: activeHit.end, kind: "hit" }];
    const ordered = [...(file?.segments ?? [])].sort((left, right) => left.start - right.start);
    const current = ordered.findIndex((segment) => segment.start === activeHit.start && segment.end === activeHit.end);
    for (const neighbor of [ordered[current - 1], ordered[current + 1]]) {
      if (neighbor) ranges.push({ from: neighbor.start, to: neighbor.end, kind: "neighbor" });
    }
    return ranges;
  }, [path, stale, activeHit, file?.segments]);

  useEffect(() => {
    if (writeView !== "segments") return;
    const cuts = segmentMarkdown(draftRef.current);
    segmentCutsRef.current = cuts;
    setSegmentCuts(cuts);
  }, [path, writeView]);

  useEffect(() => {
    if (!activeHit || activeHit.path !== path) return;
    editorRef.current?.scrollTo(activeHit.start);
    // 只在切换命中或文件时定位。编辑会让文档变旧并清掉高亮，不能因此滚回段首。
  }, [activeHit, path]);

  useEffect(() => {
    if (!menu) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!inTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const stored = await host.session();
        if (cancelled) return;
        await loadStorage(stored.selection);
        if (stored.warnings.length > 0) setMessages(stored.warnings);
      } catch (error) {
        if (!cancelled) setMessages([error instanceof Error ? error.message : "无法读取存储"]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadStorage(stored: Selection | null) {
    const [listed, storedIndex, storedSettings] = await Promise.all([
      host.listTree(),
      readJson<ProjectIndex>(INDEX_PATH, emptyIndex()),
      host.loadSettings(),
    ]);
    setTree(listed);
    setIndex(storedIndex.version === 1 ? storedIndex : emptyIndex());
    setSettings({ ...defaultSettings, ...storedSettings });
    setSelection(stored);
    if (stored?.kind === "file") {
      const text = await host.readText(stored.path);
      setPath(stored.path);
      setDraft(text);
    }
  }

  async function refreshTree() {
    setTree(await host.listTree());
  }

  function choose(next: Selection | null) {
    setSelection(next);
    if (next) void host.rememberSelection(next.kind, next.path);
  }

  function createParent(): string {
    const current = selectionRef.current;
    if (!current) return "";
    return current.kind === "folder" ? current.path : parentPath(current.path);
  }

  function askText(title: string, label: string, initial = ""): Promise<string | null> {
    return new Promise((resolve) => {
      dialogResolver.current = resolve;
      setDialogValue(initial);
      setDialog({ mode: "text", title, label });
    });
  }

  function askConfirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      dialogResolver.current = (value) => resolve(value === "yes");
      setDialog({ mode: "confirm", title, message });
    });
  }

  function finishDialog(value: string | null) {
    const resolve = dialogResolver.current;
    dialogResolver.current = null;
    setDialog(null);
    resolve?.(value);
  }

  async function openFile(relativePath: string) {
    await saveDraft();
    const text = await host.readText(relativePath);
    setPath(relativePath);
    setDraft(text);
    choose({ kind: "file", path: relativePath });
  }

  async function saveDraft() {
    if (!pathRef.current) return;
    await host.writeText(pathRef.current, draftRef.current);
  }

  async function persistIndex(next: ProjectIndex) {
    setIndex(next);
    await host.writeText(INDEX_PATH, JSON.stringify(next, null, 2));
  }

  async function persistSettings(next: Settings) {
    setSettings(next);
    await host.saveSettings(next);
  }

  async function analyze() {
    if (!path) return;
    setBusy(true);
    try {
      await saveDraft();
      const text = draftRef.current;
      const result = await analyzeDocument({
        index,
        relativePath: path,
        text,
        now: new Date().toISOString(),
        complete: createOpenAIClient(settings),
        scope,
      });
      await persistIndex(result.index);
      setMessages(result.messages);
    } catch (error) {
      setMessages([error instanceof Error ? error.message : "分析失败"]);
    } finally {
      setBusy(false);
    }
  }

  function editCut(index: number, nextText: string) {
    const cuts = segmentCutsRef.current;
    const current = cuts[index];
    if (!current) return;
    const base = draftRef.current;
    const nextDraft = `${base.slice(0, current.start)}${nextText}${base.slice(current.end)}`;
    const delta = nextText.length - (current.end - current.start);
    const nextCuts = cuts.map((cut, cutIndex) => {
      if (cutIndex === index) return { ...cut, end: current.start + nextText.length, text: nextText };
      if (cut.start >= current.end) return { ...cut, start: cut.start + delta, end: cut.end + delta };
      return cut;
    });
    draftRef.current = nextDraft;
    segmentCutsRef.current = nextCuts;
    setDraft(nextDraft);
    setSegmentCuts(nextCuts);
  }

  function refreshCutsFromDraft() {
    const cuts = segmentMarkdown(draftRef.current);
    segmentCutsRef.current = cuts;
    setSegmentCuts(cuts);
  }

  async function analyzeSegment(headingPath: string[], ordinal: number) {
    if (!path) return;
    setBusy(true);
    try {
      await saveDraft();
      const text = draftRef.current;
      const result = await analyzeDocument({
        index,
        relativePath: path,
        text,
        now: new Date().toISOString(),
        complete: createOpenAIClient(settings),
        scope,
        target: { headingPath, ordinal },
      });
      await persistIndex(result.index);
      refreshCutsFromDraft();
      setMessages(result.messages);
    } catch (error) {
      setMessages([error instanceof Error ? error.message : "分析失败"]);
    } finally {
      setBusy(false);
    }
  }

  async function createFile() {
    setCreateOpen(false);
    try {
      const entered = await askText("新建文件", "名称");
      if (!entered) return;
      const relativePath = await host.createFile(createParent(), entered);
      await refreshTree();
      await openFile(relativePath);
    } catch (error) {
      setMessages([error instanceof Error ? error.message : "无法新建文件"]);
    }
  }

  async function createFolder() {
    setCreateOpen(false);
    try {
      const entered = await askText("新建文件夹", "名称");
      if (!entered) return;
      const relativePath = await host.createFolder(createParent(), entered);
      await refreshTree();
      choose({ kind: "folder", path: relativePath });
    } catch (error) {
      setMessages([error instanceof Error ? error.message : "无法新建文件夹"]);
    }
  }

  async function importFiles(into: string) {
    try {
      await saveDraft();
      const imported = await host.importMarkdown(into);
      await refreshTree();
      if (imported[0]) await openFile(imported[0]);
    } catch (error) {
      setMessages([error instanceof Error ? error.message : "无法导入文件"]);
    }
  }

  async function renameNode(target: TreeNode) {
    try {
      const nextName = await askText(
        target.kind === "folder" ? "修改文件夹名" : "修改文件名",
        "新的名称，仍在当前目录",
        target.path.split("/").pop() ?? target.path,
      );
      if (!nextName) return;
      await saveDraft();
      const nextPath = await host.renamePath(target.path, nextName);
      const next = renameIndexedFile(index, target.path, nextPath);
      await persistIndex(next);
      await refreshTree();
      choose({ kind: target.kind, path: nextPath });
      if (pathRef.current && (pathRef.current === target.path || pathRef.current.startsWith(`${target.path}/`))) {
        const opened = pathRef.current === target.path
          ? nextPath
          : `${nextPath}/${pathRef.current.slice(target.path.length + 1)}`;
        setPath(opened);
      }
    } catch (error) {
      setMessages([error instanceof Error ? error.message : "无法改名"]);
    }
  }

  async function deleteNode(target: TreeNode) {
    const confirmed = await askConfirm(
      target.kind === "folder" ? "删除文件夹" : "删除文件",
      `删除 ${target.path}？对应的标签和任务会一起删除。`,
    );
    if (!confirmed) return;
    const next = removeIndexedFile(index, target.path);
    await host.removePath(target.path);
    await persistIndex(next);
    await refreshTree();
    if (selectionRef.current && (selectionRef.current.path === target.path || selectionRef.current.path.startsWith(`${target.path}/`))) {
      choose(null);
    }
    if (pathRef.current && (pathRef.current === target.path || pathRef.current.startsWith(`${target.path}/`))) {
      setPath(null);
      setDraft("");
    }
  }

  async function exportFile(target: string) {
    const text = pathRef.current === target ? draftRef.current : await host.readText(target);
    await host.exportText(target.split("/").pop() ?? "notes.md", exportDocument(text));
  }

  function moveHit(delta: number) {
    if (hits.length === 0) return;
    const next = (hitIndex + delta + hits.length) % hits.length;
    setHitIndex(next);
    const hit = hits[next];
    if (hit.path !== path) void openFile(hit.path);
  }

  function openHit(index: number) {
    const hit = hits[index];
    if (!hit) return;
    setHitIndex(index);
    setScreen("write");
    if (hit.path !== path) void openFile(hit.path);
  }

  return (
    <div className="app">
      <div className="chrome">
        <header className="toolbar">
          <strong className="project-name">Maid</strong>
          <button onClick={() => void analyze()} disabled={!path || busy}>{busy ? "分析中" : "分析"}</button>
          <div className="modes" role="group" aria-label="界面">
            <button type="button" aria-pressed={screen === "write"} onClick={() => setScreen("write")}>写作</button>
            <button type="button" aria-pressed={screen === "review"} onClick={() => setScreen("review")}>整理</button>
          </div>
          <button
            type="button"
            aria-expanded={showSettings}
            onClick={() => setShowSettings((value) => !value)}
          >
            API 设置
          </button>
        </header>
        {showSettings && (
          <form
            className="settings"
            onSubmit={(event) => {
              event.preventDefault();
              void persistSettings(settings);
              setShowSettings(false);
              setMessages(["API 设置已保存"]);
            }}
          >
            <label>
              接口地址
              <input
                value={settings.baseUrl}
                spellCheck={false}
                onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })}
              />
            </label>
            <label>
              API 密钥
              <input
                type="password"
                value={settings.apiKey}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
              />
            </label>
            <label>
              模型名称
              <input
                value={settings.model}
                spellCheck={false}
                onChange={(event) => setSettings({ ...settings, model: event.target.value })}
              />
            </label>
            <button type="submit">保存</button>
            <p className="hint">
              使用 OpenAI 兼容的 Chat Completions。本机 Ollama 默认地址是 http://localhost:11434/v1，密钥可以是任意非空字符串。
            </p>
          </form>
        )}
      </div>
      {!inTauri() ? (
        <p className="empty">请用 <code>npm run tauri dev</code> 启动桌面应用。浏览器预览无法使用 Maid 的本机项目存储。</p>
      ) : (
        screen === "write" ? (
          <main className="workspace">
            <aside
              className="files"
              onContextMenu={(event) => {
                event.preventDefault();
                setCreateOpen(false);
                setMenu({ x: event.clientX, y: event.clientY, target: null });
              }}
            >
              <ul>
                {tree.map((item) => (
                  <li key={`${item.kind}:${item.path}`}>
                    <button
                      className={selection?.path === item.path ? "active" : ""}
                      aria-label={item.path}
                      style={{ paddingLeft: `${8 + item.path.split("/").length * 12}px` }}
                      onClick={() => {
                        if (item.kind === "folder") choose({ kind: "folder", path: item.path });
                        else void openFile(item.path);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setCreateOpen(false);
                        setMenu({ x: event.clientX, y: event.clientY, target: item });
                      }}
                    >
                      {item.path.split("/").pop()}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="file-add"
                aria-label="新建"
                aria-expanded={createOpen}
                onClick={() => {
                  setMenu(null);
                  setCreateOpen((open) => !open);
                }}
              >
                +
              </button>
              {createOpen && (
                <div className="file-menu create-menu" role="menu" aria-label="新建">
                  <button type="button" role="menuitem" onClick={() => void createFile()}>新建文件</button>
                  <button type="button" role="menuitem" onClick={() => void createFolder()}>新建文件夹</button>
                </div>
              )}
              {menu && (
                <div
                  ref={menuRef}
                  className="file-menu"
                  role="menu"
                  aria-label="文件操作"
                  style={{ left: menu.x, top: menu.y }}
                >
                  <button type="button" role="menuitem" onClick={() => {
                    const into = menu.target?.kind === "file" ? parentPath(menu.target.path) : (menu.target?.path ?? createParent());
                    setMenu(null);
                    void importFiles(into);
                  }}>导入</button>
                  {menu.target && (
                    <>
                      <button type="button" role="menuitem" onClick={() => { const target = menu.target; setMenu(null); if (target) void renameNode(target); }}>改名</button>
                      <button type="button" role="menuitem" onClick={() => { const target = menu.target; setMenu(null); if (target) void deleteNode(target); }}>删除</button>
                      {menu.target.kind === "file" && (
                        <button type="button" role="menuitem" onClick={() => { const target = menu.target; setMenu(null); if (target) void exportFile(target.path); }}>导出</button>
                      )}
                    </>
                  )}
                </div>
              )}
            </aside>
            <section
              className="stage"
              tabIndex={tag || status ? 0 : undefined}
              onKeyDownCapture={(event) => {
                if (!tag && !status) return;
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                event.stopPropagation();
                moveHit(event.key === "ArrowDown" ? 1 : -1);
              }}
            >
              {path ? (
                <>
                  <div className="modes stage-switch" role="group" aria-label="展示">
                    <button type="button" aria-pressed={writeView === "whole"} onClick={() => setWriteView("whole")}>整篇</button>
                    <button type="button" aria-pressed={writeView === "segments"} onClick={() => { refreshCutsFromDraft(); setWriteView("segments"); }}>按段</button>
                  </div>
                  {writeView === "whole" ? (
                    <SourceEditor
                      ref={editorRef}
                      fileKey={path}
                      value={draft}
                      highlights={highlights}
                      onChange={setDraft}
                    />
                  ) : (
                    <div className="segment-edit-list">
                      {segmentCuts.map((cut, index) => (
                        <article
                          className="segment-edit"
                          key={`${cut.headingPath.join("\u0000")}:${cut.ordinal}`}
                          onBlur={(event) => {
                            const next = event.relatedTarget;
                            if (!(next instanceof Node) || event.currentTarget.contains(next)) return;
                            refreshCutsFromDraft();
                          }}
                        >
                          <p className="segment-meta">{formatHeadingPath(cut.headingPath) || "无标题"}</p>
                          <SourceEditor
                            fileKey={`${path}:${cut.headingPath.join("\u0000")}:${cut.ordinal}`}
                            value={cut.text}
                            highlights={[]}
                            onChange={(next) => editCut(index, next)}
                          />
                          <button type="button" onClick={() => void analyzeSegment(cut.headingPath, cut.ordinal)} disabled={busy}>
                            {busy ? "分析中" : "分析这段"}
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              ) : <p className="empty">新建或选择一篇 Markdown。</p>}
            </section>
          </main>
        ) : (
          <main className="review" aria-label="整理">
            <header className="review-head">
              <h1>整理</h1>
              <p>按标签和任务状态查看当前选中的文件或文件夹。点开一段，回到写作并定位。</p>
              <div className="review-filters">
                <label className="filters">
                  标签
                  <select aria-label="标签" value={tag} onChange={(event) => { setTag(event.target.value); setHitIndex(0); }}>
                    <option value="">全部</option>
                    {STAGE_TAGS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="filters">
                  状态
                  <select aria-label="状态" value={status} onChange={(event) => { setStatus(event.target.value); setHitIndex(0); }}>
                    <option value="">全部</option>
                    {TASK_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              </div>
            </header>
            <div className="review-scroll">
              {hits.length === 0 ? (
                <p className="empty">没有符合条件的段。先在写作里分析文档，或放宽筛选。</p>
              ) : (
                <div className="segment-list">
                  {hits.map((hit, hitOrder) => (
                    <article className={hitOrder === hitIndex ? "segment active" : "segment"} key={`${hit.path}:${hit.start}`}>
                      <button type="button" className="segment-open" onClick={() => openHit(hitOrder)}>
                        <p className="segment-meta">{hit.path} · {formatHeadingPath(hit.headingPath) || "无标题"}</p>
                        <p className="excerpt">{hit.text}</p>
                        {hit.task && <p className="summary">{hit.task.summary}</p>}
                      </button>
                      <div className="segment-actions">
                        <div className="tags">
                          {hit.tags.map((item) => (
                            <button
                              key={item}
                              type="button"
                              onClick={() => {
                                const next = updateSegmentTags(index, hit.path, hit.headingPath, hit.ordinal, hit.tags.filter((tagName) => tagName !== item));
                                if (next.ok) void persistIndex(next.index);
                              }}
                            >
                              {item} ×
                            </button>
                          ))}
                        </div>
                        <form
                          className="tag-add"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = event.currentTarget;
                            const input = form.elements.namedItem("tag") as HTMLSelectElement;
                            if (!input.value) return;
                            const next = updateSegmentTags(index, hit.path, hit.headingPath, hit.ordinal, [...hit.tags, input.value]);
                            if (!next.ok) {
                              setMessages([hit.tags.length >= 2 ? "一段最多两个主题标签" : "只能选择固定阶段"]);
                              return;
                            }
                            input.value = "";
                            void persistIndex(next.index);
                          }}
                        >
                          <select aria-label="新增标签" name="tag" defaultValue="">
                            <option value="">选择阶段</option>
                            {STAGE_TAGS.filter((item) => !hit.tags.includes(item)).map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                          <button type="submit">添加</button>
                        </form>
                        {hit.task && (
                          <select
                            aria-label="任务状态"
                            value={hit.task.status}
                            onChange={(event) => {
                              void persistIndex(updateTaskStatus(index, hit.path, hit.headingPath, hit.ordinal, event.target.value as TaskStatus));
                            }}
                          >
                            {TASK_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {index.unmatched.filter((item) => pathInScope(item.filePath, scope)).length > 0 && (
                <section className="unmatched" aria-label="未匹配">
                  <h2>未匹配</h2>
                  {index.unmatched.filter((item) => pathInScope(item.filePath, scope)).map((item) => (
                    <article className="segment" key={item.id}>
                      <p className="segment-meta">{item.filePath} · 未匹配</p>
                      <p className="summary">{item.task.summary}</p>
                      <p className="segment-meta">{item.task.status}</p>
                      <button type="button" onClick={() => void persistIndex(dismissUnmatched(index, item.id))}>关闭</button>
                    </article>
                  ))}
                </section>
              )}
            </div>
          </main>
        )
      )}
      {dialog && (
        <div className="dialog-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="maid-dialog-title"
            onSubmit={(event) => {
              event.preventDefault();
              if (dialog.mode !== "text") return;
              const value = dialogValue.trim();
              if (!value) return;
              finishDialog(value);
            }}
          >
            <h2 id="maid-dialog-title">{dialog.title}</h2>
            {dialog.mode === "text" ? (
              <label>
                {dialog.label}
                <input
                  value={dialogValue}
                  autoFocus
                  spellCheck={false}
                  onChange={(event) => setDialogValue(event.target.value)}
                />
              </label>
            ) : (
              <p>{dialog.message}</p>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={() => finishDialog(null)}>取消</button>
              {dialog.mode === "text" ? (
                <button type="submit">确定</button>
              ) : (
                <button type="button" onClick={() => finishDialog("yes")}>删除</button>
              )}
            </div>
          </form>
        </div>
      )}
      <footer className="status">
        <span>{path ?? "未打开文件"}</span>
        <span className="grow">{messages.join("；")}</span>
        {(tag || status) && hits.length > 0 && (
          <span>检索 {hitIndex + 1}/{hits.length}，在写作里按上下键移动</span>
        )}
      </footer>
    </div>
  );
}

type TextDialog = { mode: "text"; title: string; label: string };
type ConfirmDialog = { mode: "confirm"; title: string; message: string };
type FileMenu = { x: number; y: number; target: TreeNode | null };

async function readJson<T>(relativePath: string, fallback: T): Promise<T> {
  try {
    const text = await host.readText(relativePath);
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
