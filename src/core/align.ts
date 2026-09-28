import { similarity } from "./hash";
import type { SegmentRecord } from "./types";
import type { SegmentDraft } from "./segment";

export type AlignedPair =
  | { kind: "unchanged"; previous: SegmentRecord; draft: SegmentDraft }
  | { kind: "changed"; previous: SegmentRecord; draft: SegmentDraft }
  | { kind: "fresh"; draft: SegmentDraft };

export interface AlignResult {
  pairs: AlignedPair[];
  unmatched: SegmentRecord[];
}

export function alignSegments(previous: SegmentRecord[], drafts: SegmentDraft[]): AlignResult {
  const remainingOld = [...previous];
  const remainingNew = drafts.map((draft, index) => ({ draft, index }));
  const matched = new Map<number, { previous: SegmentRecord; changed: boolean }>();

  pairUnique((item) => item.contentHash, remainingOld, remainingNew, matched, false);
  pairByHeading(remainingOld, remainingNew, matched);

  const pairs: AlignedPair[] = drafts.map((draft, index) => {
    const match = matched.get(index);
    if (!match) return { kind: "fresh", draft };
    if (!match.changed) return { kind: "unchanged", previous: match.previous, draft };
    return { kind: "changed", previous: match.previous, draft };
  });

  return {
    pairs,
    unmatched: remainingOld.filter((segment) => segment.task !== null),
  };
}

function pairByHeading(
  remainingOld: SegmentRecord[],
  remainingNew: { draft: SegmentDraft; index: number }[],
  matched: Map<number, { previous: SegmentRecord; changed: boolean }>,
): void {
  const paths = new Set([
    ...remainingOld.map((segment) => pathKey(segment.headingPath)),
    ...remainingNew.map((item) => pathKey(item.draft.headingPath)),
  ]);

  for (const key of paths) {
    const olds = remainingOld.filter((segment) => pathKey(segment.headingPath) === key);
    const news = remainingNew.filter((item) => pathKey(item.draft.headingPath) === key);
    let chosen: { old: SegmentRecord; item: { draft: SegmentDraft; index: number } }[] = [];
    if (olds.length === 1 && news.length === 1) {
      chosen = [{ old: olds[0], item: news[0] }];
    } else if (olds.length === news.length && olds.length > 1) {
      chosen = mutualPairs(olds, news);
    }
    for (const pair of chosen) {
      take(remainingOld, remainingNew, pair.old, pair.item, matched);
    }
  }
}

function mutualPairs(
  olds: SegmentRecord[],
  news: { draft: SegmentDraft; index: number }[],
): { old: SegmentRecord; item: { draft: SegmentDraft; index: number } }[] {
  const scores = olds.map((old) =>
    news.map((item) => similarity(old.text, item.draft.text)),
  );
  const chosen: { old: SegmentRecord; item: { draft: SegmentDraft; index: number } }[] = [];
  const usedNews = new Set<number>();
  for (let oldIndex = 0; oldIndex < olds.length; oldIndex += 1) {
    const ranking = scores[oldIndex]
      .map((score, newIndex) => ({ score, newIndex }))
      .sort((left, right) => right.score - left.score);
    const best = ranking[0];
    const second = ranking[1]?.score ?? 0;
    if (!best || best.score < 0.85 || best.score - second < 0.1 || usedNews.has(best.newIndex)) {
      return [];
    }
    const reverse = olds
      .map((_, index) => scores[index][best.newIndex])
      .sort((left, right) => right - left);
    if (reverse[0] !== best.score || (reverse[1] ?? 0) > best.score - 0.1) return [];
    usedNews.add(best.newIndex);
    chosen.push({ old: olds[oldIndex], item: news[best.newIndex] });
  }
  return chosen.length === olds.length ? chosen : [];
}

function pairUnique(
  hashOfOld: (segment: SegmentRecord) => string,
  remainingOld: SegmentRecord[],
  remainingNew: { draft: SegmentDraft; index: number }[],
  matched: Map<number, { previous: SegmentRecord; changed: boolean }>,
  forceChanged: boolean,
): void {
  const oldByHash = groupBy(remainingOld, hashOfOld);
  const newByHash = groupBy(remainingNew, (item) => item.draft.contentHash);
  for (const [hash, olds] of oldByHash) {
    const news = newByHash.get(hash);
    if (olds.length !== 1 || !news || news.length !== 1) continue;
    take(remainingOld, remainingNew, olds[0], news[0], matched, forceChanged);
  }
}

function take(
  remainingOld: SegmentRecord[],
  remainingNew: { draft: SegmentDraft; index: number }[],
  old: SegmentRecord,
  item: { draft: SegmentDraft; index: number },
  matched: Map<number, { previous: SegmentRecord; changed: boolean }>,
  forceChanged = false,
): void {
  const oldIndex = remainingOld.indexOf(old);
  const newIndex = remainingNew.indexOf(item);
  if (oldIndex === -1 || newIndex === -1) return;
  remainingOld.splice(oldIndex, 1);
  remainingNew.splice(newIndex, 1);
  matched.set(item.index, {
    previous: old,
    changed: forceChanged || old.contentHash !== item.draft.contentHash || old.pendingModel,
  });
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function pathKey(path: string[]): string {
  return path.join("\u0000");
}
