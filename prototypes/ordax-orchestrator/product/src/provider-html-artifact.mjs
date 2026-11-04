import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const HTML_ARTIFACT_LIMIT_BYTES=2*1024*1024;
const SAFE_HTML_NAME=/^[a-z0-9][a-z0-9_.-]{0,99}\.html?$/i;

export function validateHtmlArtifactName(filename) {
  if(typeof filename!=='string'||filename.length>105||
    !SAFE_HTML_NAME.test(filename)||filename.startsWith('.')||
    filename.includes('..')||filename.includes('/')||filename.includes('\\'))
    throw Error('provider_html_filename_invalid');
  return filename;
}
export function verifyLocalHtmlArtifact(filePath,{expectedName='index.html'}={}) {
  validateHtmlArtifactName(expectedName);
  const name=path.basename(filePath||'');
  validateHtmlArtifactName(name);
  const stats=fs.lstatSync(filePath);
  if(!stats.isFile()||stats.isSymbolicLink()||
    stats.size<40||stats.size>HTML_ARTIFACT_LIMIT_BYTES)
    throw Error('provider_html_file_invalid');
  const bytes=fs.readFileSync(filePath);
  if(bytes.length!==stats.size||bytes.includes(0))
    throw Error('provider_html_file_invalid');
  let text=bytes.toString('utf8').replace(/^\uFEFF/,'').trim();
  if(!/^<!doctype\s+html\b/i.test(text)||
    !/<html(?:\s|>)/i.test(text)||
    !/<body(?:\s|>)/i.test(text)||
    !/<\/body\s*>/i.test(text)||
    !/<\/html\s*>\s*$/i.test(text))
    throw Error('provider_html_structure_unverified');
  return {filename:expectedName,bytes:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex'),
    verification:'local_bytes_and_structure'};
}
export function assertLocalArtifactPath(root,filePath) {
  const canonicalRoot=path.resolve(root)+path.sep;
  const destination=path.resolve(filePath);
  if(!destination.startsWith(canonicalRoot))
    throw Error('provider_html_path_outside_store');
  return destination;
}
