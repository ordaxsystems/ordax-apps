// Only already-verified local HTML is eligible. This document runs in an
// entirely separate, in-memory, no-preload Chromium renderer, never the
// privileged OrdaX UI or the signed-in provider session.
export const INTERACTIVE_PREVIEW_MAX_BYTES=512*1024;
export const INTERACTIVE_PREVIEW_CSP=[
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ');

export function buildInteractiveHtmlDocument(html){
  if(typeof html!=='string'||!html.trimStart().toLowerCase().startsWith('<!doctype html')||
     new TextEncoder().encode(html).byteLength>INTERACTIVE_PREVIEW_MAX_BYTES)
    throw Error('interactive_html_preview_source_invalid');
  return '<meta http-equiv="Content-Security-Policy" content="'+
    INTERACTIVE_PREVIEW_CSP+'"><meta name="referrer" content="no-referrer">'+
    '<meta charset="utf-8">'+html;
}
export function isPreviewNetworkRequestAllowed(url){
  // No HTTP(S), WS(S), file, blob, filesystem, localhost or other scheme.
  // data: subresources are additionally constrained by the CSP.
  return typeof url==='string'&&url.startsWith('data:');
}
