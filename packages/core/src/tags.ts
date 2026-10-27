/**
 * Display tag: "J-0147", with block code "CB12-J-0147", leave-tree series "J-L0003".
 * Numbers are zero-padded to at least 4 digits.
 */
export function formatTag(prefix: string, n: number, opts?: { blockCode?: string; leave?: boolean }): string {
  const num = String(Math.max(0, Math.trunc(n))).padStart(4, '0');
  const p = prefix.trim().toUpperCase();
  const block = opts?.blockCode?.trim().toUpperCase();
  return `${block ? `${block}-` : ''}${p}-${opts?.leave ? 'L' : ''}${num}`;
}

/** Next tag number = max existing + 1 (voided numbers are never reused). 1 when none. */
export function nextTagNumber(existingNumbers: number[]): number {
  let max = 0;
  for (const n of existingNumbers) if (Number.isFinite(n) && n > max) max = Math.trunc(n);
  return max + 1;
}
