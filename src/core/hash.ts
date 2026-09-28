import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

export function contentHash(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  let leftCount = 0;
  let rightCount = 0;
  for (const count of left.values()) leftCount += count;
  for (const count of right.values()) rightCount += count;
  for (const [gram, count] of left) {
    overlap += Math.min(count, right.get(gram) ?? 0);
  }
  return (2 * overlap) / (leftCount + rightCount);
}

function bigrams(value: string): Map<string, number> {
  const compact = value.replace(/\s+/g, "");
  const grams = new Map<string, number>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    const gram = compact.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}
