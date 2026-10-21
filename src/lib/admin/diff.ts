/** A line diff for the review page: what changed since the previous version. */

export type DiffLine = { op: " " | "+" | "-"; text: string; a?: number; b?: number };
export type DiffHunk = { lines: DiffLine[] } | { skipped: number };

/** Longest-common-subsequence line diff; inputs past `max` lines are compared as added/removed wholesale */
export function lineDiff(before: string, after: string, max = 3000): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > max || b.length > max) return [...a.map((text, i) => ({ op: "-" as const, text, a: i + 1 })), ...b.map((text, i) => ({ op: "+" as const, text, b: i + 1 }))];
  // trim the common head and tail first: most versions change a few lines
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const A = a.slice(head, a.length - tail);
  const B = b.slice(head, b.length - tail);
  const n = A.length, m = B.length;
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  for (let i = 0; i < head; i++) out.push({ op: " ", text: a[i], a: i + 1, b: i + 1 });
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { out.push({ op: " ", text: A[i], a: head + i + 1, b: head + j + 1 }); i++; j++; }
    // removals before additions, the way diffs are usually read
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { out.push({ op: "-", text: A[i], a: head + i + 1 }); i++; }
    else { out.push({ op: "+", text: B[j], b: head + j + 1 }); j++; }
  }
  for (let k = 0; k < tail; k++) out.push({ op: " ", text: a[a.length - tail + k], a: a.length - tail + k + 1, b: b.length - tail + k + 1 });
  return out;
}

/** Keep `context` unchanged lines around each change; longer unchanged runs fold into a "skipped" marker */
export function hunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const keep = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.op !== " ") for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: DiffHunk[] = [];
  let cur: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) { out.push({ skipped }); skipped = 0; }
      cur.push(l);
    } else {
      if (cur.length) { out.push({ lines: cur }); cur = []; }
      skipped++;
    }
  });
  if (cur.length) out.push({ lines: cur });
  if (skipped) out.push({ skipped });
  return out;
}

export const changed = (lines: DiffLine[]) => ({ added: lines.filter((l) => l.op === "+").length, removed: lines.filter((l) => l.op === "-").length });

/** Files added, removed or changed between two `path → sha256:…` manifests */
export function fileChanges(before: Record<string, string> | null, after: Record<string, string>) {
  const prev = before ?? {};
  const paths = [...new Set([...Object.keys(prev), ...Object.keys(after)])].sort();
  return paths
    .map((p) => ({ path: p, change: !(p in prev) ? ("added" as const) : !(p in after) ? ("removed" as const) : prev[p] !== after[p] ? ("changed" as const) : ("same" as const) }))
    .filter((f) => before === null || f.change !== "same");
}
