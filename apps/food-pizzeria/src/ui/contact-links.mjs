export function telephoneHref(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const digits = normalized.replace(/\D/g, "");
  if (!digits) return null;
  return `${normalized.startsWith("+") ? "+" : ""}${digits}`;
}
