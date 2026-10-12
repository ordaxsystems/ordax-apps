// App-owned user notes, distinct from canonical Memory/continuity. Included once
// in the first user message, with visible text and within the message budget.
export function projectMessage({ project, messages = [], message, enabled = true }) {
  const attachments = [...(message.attachments || [])];
  if (enabled && !messages.length && project?.instructions?.trim()) {
    const name = `Contexto do projeto — ${project.name}.txt`;
    if (!attachments.some(item => item.name === name && item.text === project.instructions)) attachments.push({ kind: 'text', name, text: project.instructions });
  }
  return { ...message, attachments };
}
