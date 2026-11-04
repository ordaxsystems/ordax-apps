// Pure rendering boundary for HTML downloaded from GPT Web.
// The iframe MUST have sandbox="" (no allow-scripts or allow-same-origin).
// CSP is the first parsed markup token, before any model-controlled markup.
export const STATIC_PREVIEW_CSP=[
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ');

export function buildStaticPreviewSource(html) {
  if(typeof html!=='string'||html.length<40||
    new TextEncoder().encode(html).byteLength>2*1024*1024||
    !html.trimStart().toLowerCase().startsWith('<!doctype html'))
    throw Error('static_html_preview_source_invalid');
  // A meta CSP in srcdoc takes effect before any external URL, stylesheet,
  // HTML node, script or form originating from an untrusted file is parsed.
  return '<meta http-equiv="Content-Security-Policy" content="'+
    STATIC_PREVIEW_CSP+'"><meta charset="utf-8">'+html;
}
