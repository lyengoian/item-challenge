// npx ts-node liveCoding.ts
/**
 *
 * NOTE: PLEASE USE PREFERRED LANGUAGE
 *
 * Part 1: Most Frequent Secure Tag
 *
 * You are given an array of ExamItem objects.
 *
 * Implement the function `mostFrequentSecureTag`.
 *
 * Rules:
 * - Only consider items where:
 *     - securityLevel === "secure" OR
 *     - securityLevel === "highly-secure"
 * - Count every occurrence of every tag across those items.
 * - Return the tag that appears the most total times.
 * - If there is a tie, you may return any one of them.
 * - If there are no secure items, or no tags on secure items,
 *   return null.
 *
 * Example:
 */

/**
 * Minimal ExamItem shape needed for this exercise.
 */
export interface ExamItem {
  id: string;
  metadata: {
    tags: string[];
  };
  securityLevel: string; // "standard" | "secure" | "highly-secure"
}

export function mostFrequentSecureTag(items: ExamItem[]): string | null {
  const filteredItems = items.filter((item: ExamItem) =>
    ["secure", "highly-secure"].includes(item.securityLevel),
  );
  if (filteredItems.length == 0) return null;

  const tagOccurences = new Map<string, number>();
  filteredItems.forEach((item: ExamItem) => {
    item.metadata.tags.forEach((tag: string) => {
      tagOccurences.set(tag, (tagOccurences.get(tag) || 0) + 1);
    });
  });

  if (tagOccurences.size == 0) return null;

  let maxValue = 0;
  let maxTag = "";
  for (const [tag, occurence] of tagOccurences.entries()) {
    if (occurence > maxValue) {
      maxValue = occurence;
      maxTag = tag;
    }
  }

  return maxTag;
}

const items = [
  {
    id: "1",
    securityLevel: "secure",
    metadata: { tags: ["algebra", "functions"] },
  },
  {
    id: "2",
    securityLevel: "highly-secure",
    metadata: { tags: ["algebra"] },
  },
  {
    id: "3",
    securityLevel: "standard",
    metadata: { tags: ["algebra"] },
  },
];

console.log(mostFrequentSecureTag(items)); // "algebra"

/**
 * --------------------------------------------------
 * Part 2 — Most Dominant Secure Tag
 * --------------------------------------------------
 *
 * Now implement `mostDominantSecureTag`.
 *
 * This time, instead of counting all tag occurrences globally:
 *
 * - For each secure item:
 *     - Determine which tag(s) appear most frequently
 *       within that item.
 *     - If there is a tie for most frequent tag within
 *       the item, that item contributes 1 "dominance vote"
 *       to EACH of the tied tags.
 * - After evaluating all secure items,
 *   return the tag with the most dominance votes.
 *
 * Notes:
 * - If there is a tie in total dominance votes across all items,
 *   you may return any one of the tied tags.
 * - If there are no secure items, or no tags on secure items,
 *   return null.
 *
 */

export function mostDominantSecureTag(items: ExamItem[]): string | null {
  const filteredItems = items.filter((item: ExamItem) =>
    ["secure", "highly-secure"].includes(item.securityLevel),
  );
  if (filteredItems.length == 0) return null;
  const dominanceVotes = new Map<string, number>();
  filteredItems.forEach((item: ExamItem) => {
    const tagOccurences = new Map<string, number>();
    item.metadata.tags.forEach((tag: string) => {
      tagOccurences.set(tag, (tagOccurences.get(tag) || 0) + 1);
    });

    let maxValue = 0;
    let maxTag = "";
    for (const [tag, occurence] of tagOccurences.entries()) {
      if (occurence > maxValue) {
        maxValue = occurence;
        maxTag = tag;
      }
    }
    const ties = new Map<string, number>();
    for (const [tag, occurence] of tagOccurences.entries()) {
      if (occurence == maxValue) {
        ties.set(tag, occurence);
      }
    }

    for (const tag of ties.keys()) {
      dominanceVotes.set(tag, (dominanceVotes.get(tag) || 0) + 1);
    }
  });

  if (dominanceVotes.size == 0) return null;

  let maxValue = 0;
  let maxTag = "";
  for (const [tag, occurence] of dominanceVotes.entries()) {
    if (occurence > maxValue) {
      maxValue = occurence;
      maxTag = tag;
    }
  }
  return maxTag;
}
