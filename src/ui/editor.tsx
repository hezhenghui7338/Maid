import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { livePreview } from "./livePreview";

export interface HighlightRange {
  from: number;
  to: number;
  kind: "hit" | "neighbor";
}

export interface EditorHandle {
  scrollTo(position: number): void;
}

const setHighlights = StateEffect.define<HighlightRange[]>();

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setHighlights)) {
        const docLength = transaction.state.doc.length;
        return Decoration.set(
          effect.value
            .filter((range) => range.from >= 0 && range.to > range.from && range.to <= docLength)
            .map((range) =>
              Decoration.mark({ class: range.kind === "hit" ? "cm-hit" : "cm-neighbor" }).range(range.from, range.to),
            ),
          true,
        );
      }
    }
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const SourceEditor = forwardRef<
  EditorHandle,
  {
    fileKey: string;
    value: string;
    highlights: HighlightRange[];
    onChange: (value: string) => void;
  }
>(function SourceEditor({ fileKey, value, highlights, onChange }, ref) {
  const parent = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    scrollTo(position: number) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: EditorView.scrollIntoView(position, { y: "center" }) });
    },
  }));

  useEffect(() => {
    if (!parent.current) return;
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          markdown({ base: markdownLanguage }),
          livePreview(),
          highlightField,
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 只在切换文件时重建编辑器，避免输入时重置光标。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value, fileKey]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setHighlights.of(highlights) });
  }, [highlights, fileKey]);

  return <div className="editor" ref={parent} />;
});
