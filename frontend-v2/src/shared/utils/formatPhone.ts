/** Formatea un número E.164 para mostrar en UI: +573213443603 → +57 321 344 3603 */
export function formatPhone(phone: string): string {
  if (!phone) return '';
  const clean = phone.replace(/\s/g, '');
  // Colombia +57
  const m = clean.match(/^\+57(\d{3})(\d{3})(\d{4})$/);
  if (m) return `+57 ${m[1]} ${m[2]} ${m[3]}`;
  return clean;
}
