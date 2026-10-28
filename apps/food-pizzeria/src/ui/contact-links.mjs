export function telephoneHref(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const digits = normalized.replace(/\D/g, "");
  if (!digits) return null;
  return `${normalized.startsWith("+") ? "+" : ""}${digits}`;
}

export function whatsappHref(value, message) {
  if (typeof value !== "string" || typeof message !== "string" || !message.trim()) return null;
  const digits = value.replace(/\D/g, "");
  const isElevenDigitNorthAmericanNumber = digits.length === 11 && digits.startsWith("1") && !digits.startsWith("11");
  const internationalNumber = digits.length === 10 || (digits.length === 11 && !isElevenDigitNorthAmericanNumber)
    ? `55${digits}`
    : digits;
  if (!/^\d{11,15}$/.test(internationalNumber)) return null;
  return `https://wa.me/${internationalNumber}?text=${encodeURIComponent(message.trim())}`;
}
