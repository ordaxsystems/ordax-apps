// Shared verbatim transcript cleanup for Node and Chromium DOM observations.
// Never trim EACH line: indentation and interior blank lines are executable
// data in Python, YAML, shell scripts, Markdown and patches.
export function preserveProviderWhitespace(raw,noise=[]) {
  const patterns=Array.isArray(noise)?noise:[];
  return String(raw||'')
    .split(/\r?\n/)
    .filter(line=>!patterns.some(pattern=>pattern.test(line.trim())))
    .join('\n')
    .trim();
}
