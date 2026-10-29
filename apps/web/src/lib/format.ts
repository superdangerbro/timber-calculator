export const money = (n: number, digits = 0) =>
  (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const num = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const signed = (n: number, fmt: (n: number) => string) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n));
export const shortDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
};
export const isoDay = (iso: string) => iso.slice(0, 10);
export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
