export type DiffLineType = "context" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  oldLine?: number;
  newLine?: number;
  content: string;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;

  const lcs: Uint32Array[] = [];
  for (let i = 0; i <= m; i++) lcs.push(new Uint32Array(n + 1));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      lcs[i][j] =
        a[i - 1] === b[j - 1]
          ? lcs[i - 1][j - 1] + 1
          : Math.max(lcs[i - 1][j], lcs[i][j - 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: "context", oldLine: i, newLine: j, content: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      result.push({ type: "add", newLine: j, content: b[j - 1] });
      j--;
    } else {
      result.push({ type: "remove", oldLine: i, content: a[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

export function hasChanges(oldText: string, newText: string): boolean {
  return oldText !== newText;
}
