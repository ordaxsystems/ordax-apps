const GROQ_KEY=/^gsk_[A-Za-z0-9_-]{20,240}$/;
export function isValidGroqKey(value) {
  return typeof value==='string'&&GROQ_KEY.test(value);
}
