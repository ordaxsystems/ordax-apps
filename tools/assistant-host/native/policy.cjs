'use strict';
const ACCOUNT_HOSTS = new Set(['chatgpt.com', 'auth.openai.com', 'accounts.google.com', 'login.microsoftonline.com', 'login.live.com', 'appleid.apple.com', 'account.apple.com']);
function isAccountURL(value) { try { const url = new URL(value); return url.protocol === 'https:' && ACCOUNT_HOSTS.has(url.hostname); } catch { return false; } }
function surfaceBounds(width, height, expanded = false, ratio = 0.6) { const x = expanded ? 0 : Math.floor(width * ratio); return { x, y: 64, width: Math.max(1, Math.floor(width) - x), height: Math.max(1, Math.floor(height) - 96) }; }
module.exports = { isAccountURL, surfaceBounds };
