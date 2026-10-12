export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(text) {
  // Every plain-text fragment is escaped. Only app-generated tags reach innerHTML.
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let result = '', start = 0;
  for (const match of text.matchAll(pattern)) {
    result += escapeHTML(text.slice(start, match.index));
    if (match[1]) result += `<code>${escapeHTML(match[1])}</code>`;
    else if (match[2]) result += `<strong>${escapeHTML(match[2])}</strong>`;
    else result += `<a href="${escapeHTML(match[4])}" target="_blank" rel="noopener noreferrer">${escapeHTML(match[3])}</a>`;
    start = match.index + match[0].length;
  }
  return result + escapeHTML(text.slice(start));
}

export function markdownHTML(text) {
  const lines = String(text).split('\n');
  let output = '', code = null, language = '', list = null, paragraph = [];
  const codeBlock = () => `<div class="code-block"><div class="code-toolbar"><span>${escapeHTML(language || 'código')}</span><div><button type="button" data-project-code>Revisar em arquivo</button><button type="button" data-copy-code aria-label="Copiar bloco de código">Copiar código</button></div></div><pre><code>${escapeHTML(code.join('\n'))}</code></pre></div>`;
  const cells = line => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
  const flush = () => { if (paragraph.length) { output += `<p>${paragraph.map(inline).join('<br>')}</p>`; paragraph = []; } };
  const closeList = () => { if (list) { output += `</${list}>`; list = null; } };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      flush(); closeList();
      if (code === null) { code = []; language = line.trim().slice(3).trim().slice(0, 30); } else { output += codeBlock(); code = null; }
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || '')) {
      flush(); closeList(); const headers = cells(line).slice(0, 40); index++;
      output += '<div class="table-scroll"><table><thead><tr>' + headers.map(cell => `<th>${inline(cell)}</th>`).join('') + '</tr></thead><tbody>';
      for (let rows = 0; rows < 500 && lines[index + 1]?.trim() && lines[index + 1].includes('|'); rows++) {
        const row = cells(lines[++index]); output += '<tr>' + headers.map((_, column) => `<td>${inline(row[column] || '')}</td>`).join('') + '</tr>';
      }
      output += '</tbody></table></div>'; continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const item = /^\s*(?:[-*]\s+|\d+\.\s+)(.+)$/.exec(line);
    if (heading) { flush(); closeList(); output += `<h${heading[1].length + 1}>${inline(heading[2])}</h${heading[1].length + 1}>`; }
    else if (item) { flush(); const kind = /^\s*\d/.test(line) ? 'ol' : 'ul'; if (kind !== list) { closeList(); output += `<${kind}>`; list = kind; } const task = /^\[([ xX])\]\s+(.+)$/.exec(item[1]); output += task ? `<li class="task-item"><span aria-label="${task[1] === ' ' ? 'Pendente' : 'Concluído'}">${task[1] === ' ' ? '☐' : '☑'}</span> ${inline(task[2])}</li>` : `<li>${inline(item[1])}</li>`; }
    else if (/^>\s?/.test(line)) { flush(); closeList(); output += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`; }
    else if (!line.trim()) { flush(); closeList(); }
    else { closeList(); paragraph.push(line); }
  }
  flush(); closeList();
  if (code !== null) output += codeBlock();
  return output;
}
