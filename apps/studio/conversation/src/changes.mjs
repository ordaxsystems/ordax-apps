// One exact replacement hunk, bounded for display; no fuzzy application of patches.
export function changePreview(before, after) {
  const old = before.split('\n'), next = after.split('\n'); let first = 0, tail = 0;
  while (first < Math.min(old.length, next.length) && old[first] === next[first]) first++;
  while (tail < Math.min(old.length, next.length) - first && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  const removed = old.slice(first, old.length - tail), added = next.slice(first, next.length - tail);
  const lines = [`@@ linha ${first + 1} · ${removed.length} removidas · ${added.length} adicionadas @@`, ...removed.slice(0, 200).map(line => '- ' + line), ...added.slice(0, 200).map(line => '+ ' + line)];
  if (removed.length > 200 || added.length > 200) lines.push('… Prévia limitada a 200 linhas por versão. Confira o conteúdo completo no editor.');
  return lines.join('\n');
}
