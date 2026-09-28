import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";
import type { Nodes, Root } from "mdast";
import { contentHash } from "./hash";

export interface SegmentDraft {
  headingPath: string[];
  ordinal: number;
  start: number;
  end: number;
  text: string;
  contentHash: string;
}

interface CollectedBlock {
  headingPath: string[];
  start: number;
  end: number;
  kind: "listItem" | "flow";
}

const DEFAULT_MAX_CHARS = 800;

export function segmentMarkdown(source: string, options?: { maxChars?: number }): SegmentDraft[] {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as Root;
  return assignIdentity(pack(collectBlocks(tree, source), maxChars, source));
}

function collectBlocks(tree: Root, source: string): CollectedBlock[] {
  const headings: { depth: number; value: string }[] = [];
  const blocks: CollectedBlock[] = [];

  const path = () => headings.map((heading) => heading.value);

  for (const node of tree.children) {
    if (node.type === "heading") {
      while (headings.length > 0 && headings[headings.length - 1].depth >= node.depth) {
        headings.pop();
      }
      headings.push({ depth: node.depth, value: toString(node).trim() });
      continue;
    }
    if (node.type === "list") {
      for (const item of node.children) {
        pushBlock(blocks, item, path(), "listItem", source);
      }
      continue;
    }
    pushBlock(blocks, node, path(), "flow", source);
  }
  return blocks;
}

function pushBlock(
  blocks: CollectedBlock[],
  node: Nodes,
  headingPath: string[],
  kind: CollectedBlock["kind"],
  source: string,
): void {
  if (!node.position?.start.offset && node.position?.start.offset !== 0) return;
  const start = node.position.start.offset ?? 0;
  const end = node.position.end.offset ?? start;
  if (end <= start) return;
  if (source.slice(start, end).trim().length === 0) return;
  blocks.push({ headingPath, start, end, kind });
}

function pack(blocks: CollectedBlock[], maxChars: number, source: string): Omit<SegmentDraft, "ordinal" | "contentHash">[] {
  const groups: CollectedBlock[][] = [];
  let current: CollectedBlock[] = [];
  let size = 0;

  const flush = () => {
    if (current.length === 0) return;
    groups.push(current);
    current = [];
    size = 0;
  };

  for (const block of blocks) {
    if (
      current.length > 0 &&
      !samePath(current[0].headingPath, block.headingPath)
    ) {
      flush();
    }
    if (block.kind === "listItem") {
      flush();
      groups.push([block]);
      continue;
    }
    const length = source.slice(block.start, block.end).length;
    if (current.length > 0 && size + length > maxChars) flush();
    current.push(block);
    size += length;
  }
  flush();

  return groups.map((group) => {
    const start = group[0].start;
    const end = group[group.length - 1].end;
    return {
      headingPath: group[0].headingPath,
      start,
      end,
      text: source.slice(start, end),
    };
  });
}

function assignIdentity(parts: Omit<SegmentDraft, "ordinal" | "contentHash">[]): SegmentDraft[] {
  const ordinals = new Map<string, number>();
  return parts.map((part) => {
    const key = part.headingPath.join("\u0000");
    const ordinal = ordinals.get(key) ?? 0;
    ordinals.set(key, ordinal + 1);
    return {
      ...part,
      ordinal,
      contentHash: contentHash(part.text),
    };
  });
}

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
