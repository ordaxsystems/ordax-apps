// Detect only explicit, visible browser-verification notices. The caller must
// also establish that no composer or conversation messages are present before
// treating this as a send-blocking challenge.
const verificationNoticePatterns=Object.freeze([
  /verif.{0,100}navegador/iu,
  /navegador.{0,100}verif/iu,
  /verify.{0,100}browser/iu,
  /browser.{0,100}verif/iu,
  /checking.{0,80}browser/iu,
  /browser.{0,80}check/iu,
  /cookies?.{0,80}(?:required|enabled|blocked|disabled)/iu,
  /(?:enable|allow).{0,80}cookies?/iu,
  /cookies?.{0,80}(?:ativ|desativ|permit|habilit|necess)/iu,
  /(?:ativ|desativ|permit|habilit|necess).{0,80}cookies?/iu
]);

export function isProviderVerificationNotice(value=''){
  const text=typeof value==='string'?value.normalize('NFC').replace(/\s+/gu,' ').slice(0,2000):'';
  return Boolean(text)&&verificationNoticePatterns.some(pattern=>pattern.test(text));
}

export const providerVerificationNoticeProbeBootstrap=
  `const verificationNoticePatterns=[${verificationNoticePatterns.map(pattern=>
    `new RegExp(${JSON.stringify(pattern.source)},${JSON.stringify(pattern.flags)})`
  ).join(',')}];`+
  `const isProviderVerificationNotice=(${isProviderVerificationNotice.toString()});`;
