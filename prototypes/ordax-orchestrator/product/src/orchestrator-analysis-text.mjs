export function redactOrchestratorAnalysisText(value,maxLength=1200) {
  return String(value||'')
    .replace(/((?:"?)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key|password|passwd|secret)(?:"?)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,'$1[redigido]')
    .replace(/\b(?:gsk_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/gi,'[credencial redigida]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=?/gi,'Bearer [redigido]')
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,'[token JWT redigido]')
    .replace(/https?:\/\/[^\s)\]}>,]+/gi,'[link omitido]')
    .slice(0,maxLength);
}
