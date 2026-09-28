import { ensureSyntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "md-bullet";
    span.textContent = "•";
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

class RenderedBlock extends WidgetType {
  get estimatedHeight() {
    return 48;
  }

  constructor(
    private readonly kind: "code" | "table",
    private readonly body: string,
    private readonly rows: string[][],
    private readonly focusAt: number,
  ) {
    super();
  }

  eq(other: RenderedBlock) {
    return (
      other.kind === this.kind &&
      other.body === this.body &&
      other.focusAt === this.focusAt &&
      other.rows.length === this.rows.length &&
      other.rows.every((row, index) => row.join("\0") === this.rows[index]?.join("\0"))
    );
  }

  toDOM() {
    const root = this.kind === "code" ? document.createElement("pre") : document.createElement("table");
    root.className = this.kind === "code" ? "md-code" : "md-table";
    if (this.kind === "code") {
      const code = document.createElement("code");
      code.textContent = this.body;
      root.append(code);
    } else {
      this.rows.forEach((row, index) => {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const item = document.createElement(index === 0 ? "th" : "td");
          item.textContent = cell;
          tr.append(item);
        }
        root.append(tr);
      });
    }
    root.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const view = EditorView.findFromDOM(root);
      if (!view) return;
      view.dispatch({ selection: { anchor: this.focusAt } });
      view.focus();
    });
    return root;
  }

  ignoreEvent() {
    return true;
  }
}

function covers(state: EditorState, from: number, to: number) {
  const selection = state.selection.main;
  return selection.from <= to && selection.to >= from;
}

function ancestor(node: SyntaxNode, names: readonly string[]) {
  let current: SyntaxNode | null = node;
  while (current && !names.includes(current.name)) current = current.parent;
  return current;
}

function trimMarks(node: SyntaxNode, markName: string) {
  let from = node.from;
  let to = node.to;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== markName) continue;
    if (child.from === from) from = child.to;
    if (child.to === to) to = child.from;
  }
  return { from, to };
}

function linkText(node: SyntaxNode) {
  const marks: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "LinkMark") marks.push(child);
  }
  if (marks.length < 2) return null;
  return { from: marks[0].to, to: marks[1].from };
}

function lineSpan(state: EditorState, from: number, to: number) {
  const start = state.doc.lineAt(from).number;
  const end = state.doc.lineAt(Math.max(from, to - 1)).number;
  const lines: number[] = [];
  for (let number = start; number <= end; number += 1) lines.push(state.doc.line(number).from);
  return lines;
}

function splitRow(line: string) {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  return text.split("|").map((cell) => cell.trim());
}

function tableRows(source: string) {
  return source
    .split("\n")
    .map(splitRow)
    .filter((row) => row.some((cell) => cell.length > 0))
    .filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function codeBody(source: string) {
  const lines = source.split("\n");
  if (lines[0]?.startsWith("```") || lines[0]?.startsWith("~~~")) lines.shift();
  if (lines.at(-1)?.startsWith("```") || lines.at(-1)?.startsWith("~~~")) lines.pop();
  return lines.join("\n");
}

function headingLevel(name: string) {
  const match = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
  return match ? match[1] : null;
}

function render(state: EditorState): DecorationSet {
  const tree = ensureSyntaxTree(state, state.doc.length, 500);
  if (!tree) return Decoration.none;
  const lines = new Map<number, Set<string>>();
  const ranges: Range<Decoration>[] = [];
  const hiddenBlocks: { from: number; to: number }[] = [];

  const addLine = (at: number, className: string) => {
    const bucket = lines.get(at) ?? new Set<string>();
    bucket.add(className);
    lines.set(at, bucket);
  };

  tree.iterate({
    enter(node) {
      const syntax = node.node;
      const name = node.name;
      const level = headingLevel(name);
      if (level) {
        for (const at of lineSpan(state, node.from, node.to)) {
          addLine(at, "md-heading");
          addLine(at, `md-h${level}`);
        }
        return;
      }
      if (name === "HeaderMark") {
        const heading = ancestor(syntax, ["ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6"]);
        if (heading && !covers(state, heading.from, heading.to)) {
          let to = node.to;
          if (state.sliceDoc(to, to + 1) === " ") to += 1;
          ranges.push(Decoration.replace({}).range(node.from, to));
        }
        return;
      }
      if (name === "Paragraph") {
        for (const at of lineSpan(state, node.from, node.to)) addLine(at, "md-paragraph");
        return;
      }
      if (name === "StrongEmphasis" || name === "Emphasis") {
        const inner = trimMarks(syntax, "EmphasisMark");
        const className = name === "StrongEmphasis" ? "md-strong" : "md-em";
        if (inner.from < inner.to) ranges.push(Decoration.mark({ class: className }).range(inner.from, inner.to));
        return;
      }
      if (name === "EmphasisMark") {
        const block = ancestor(syntax, ["StrongEmphasis", "Emphasis"]);
        if (block && !covers(state, block.from, block.to)) ranges.push(Decoration.replace({}).range(node.from, node.to));
        return;
      }
      if (name === "InlineCode") {
        const inner = trimMarks(syntax, "CodeMark");
        if (inner.from < inner.to) ranges.push(Decoration.mark({ class: "md-inline-code" }).range(inner.from, inner.to));
        return;
      }
      if (name === "CodeMark" && ancestor(syntax, ["InlineCode"]) && !covers(state, ancestor(syntax, ["InlineCode"])!.from, ancestor(syntax, ["InlineCode"])!.to)) {
        ranges.push(Decoration.replace({}).range(node.from, node.to));
        return;
      }
      if (name === "Link") {
        const text = linkText(syntax);
        if (text && text.from < text.to) ranges.push(Decoration.mark({ class: "md-link" }).range(text.from, text.to));
        return;
      }
      if ((name === "LinkMark" || name === "URL") && ancestor(syntax, ["Link"])) {
        const link = ancestor(syntax, ["Link"])!;
        if (!covers(state, link.from, link.to)) ranges.push(Decoration.replace({}).range(node.from, node.to));
        return;
      }
      if (name === "ListItem" || name === "BulletList" || name === "OrderedList") {
        for (const at of lineSpan(state, node.from, node.to)) addLine(at, "md-list");
        return;
      }
      if (name === "ListMark" && state.sliceDoc(node.from, node.to) === "-") {
        const item = ancestor(syntax, ["ListItem"]);
        if (item && !covers(state, item.from, item.to)) ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
        return;
      }
      if (name === "Blockquote") {
        for (const at of lineSpan(state, node.from, node.to)) addLine(at, "md-quote");
        return;
      }
      if (name === "QuoteMark") {
        const quote = ancestor(syntax, ["Blockquote"]);
        if (quote && !covers(state, quote.from, quote.to)) {
          let to = node.to;
          if (state.sliceDoc(to, to + 1) === " ") to += 1;
          ranges.push(Decoration.replace({}).range(node.from, to));
        }
        return;
      }
      if (name === "FencedCode" || name === "CodeBlock") {
        if (covers(state, node.from, node.to)) {
          for (const at of lineSpan(state, node.from, node.to)) addLine(at, "md-code-source");
          return;
        }
        const start = state.doc.lineAt(node.from).from;
        const end = state.doc.lineAt(Math.max(node.from, node.to - 1)).to;
        if (start >= end) return;
        hiddenBlocks.push({ from: start, to: end });
        ranges.push(
          Decoration.replace({
            widget: new RenderedBlock("code", codeBody(state.sliceDoc(node.from, node.to)), [], node.from),
            block: true,
          }).range(start, end),
        );
        return false;
      }
      if (name === "Table") {
        if (covers(state, node.from, node.to)) {
          for (const at of lineSpan(state, node.from, node.to)) addLine(at, "md-table-source");
          return;
        }
        const start = state.doc.lineAt(node.from).from;
        const end = state.doc.lineAt(Math.max(node.from, node.to - 1)).to;
        if (start >= end) return;
        hiddenBlocks.push({ from: start, to: end });
        ranges.push(
          Decoration.replace({
            widget: new RenderedBlock("table", "", tableRows(state.sliceDoc(node.from, node.to)), node.from),
            block: true,
          }).range(start, end),
        );
        return false;
      }
    },
  });

  for (const [at, classes] of lines) {
    if (hiddenBlocks.some((block) => at >= block.from && at < block.to)) continue;
    ranges.push(Decoration.line({ class: [...classes].join(" ") }).range(at));
  }

  return ranges.length === 0 ? Decoration.none : Decoration.set(ranges, true);
}

export function livePreview(): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      return render(state);
    },
    update(value, transaction) {
      if (transaction.docChanged || transaction.selection) return render(transaction.state);
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
