// ChatGPT's official home editor may not have an ancestor HTML form.
// Strong editor identity and editability are required to recognize it.
export function isOfficialStandaloneComposer(el) {
  if (!el || !['prompt-textarea','pending-home-input','mobile-composer-prompt'].includes(el.id)) return false;
  return Boolean(el.matches?.('textarea,[contenteditable="true"],[role="textbox"]') ||
    el.querySelector?.('[contenteditable="true"],[role="textbox"]'));
}

// The formless submit path accepts exactly one enabled visible official
// ChatGPT send-button, never a generic document-wide "Enviar" control.
export function uniqueOfficialStandaloneSendButton(root,editor) {
  if (!editor || !['prompt-textarea','pending-home-input','mobile-composer-prompt'].includes(editor.id)) return null;
  const buttons=Array.from(root?.querySelectorAll?.('button[data-testid="send-button"]') || []).filter(button=>{
    if (!button || button.disabled || button.getAttribute?.('aria-disabled')==='true') return false;
    const rect=button.getBoundingClientRect?.();
    return Boolean(rect && rect.width>0 && rect.height>0 && button.getClientRects?.().length);
  });
  return buttons.length===1?buttons[0]:null;
}
