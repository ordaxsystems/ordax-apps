import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {preserveProviderWhitespace} from '../src/provider-code-format.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const worker=fs.readFileSync(path.join(here,'../desktop/embedded-worker.mjs'),'utf8');
const executable=[
  'def validate(rows):',
  '    if not rows:',
  '        return 0',
  '    total = 0',
  '    for row in rows:',
  '        total += row["value"]',
  '    return total',
  '',
  'if __name__ == "__main__":',
  '    print(validate([{"value": 2}, {"value": 3}]))'
].join('\n');

test('verbatim multiline Python and blank lines survive provider cleanup',()=>{
  const input='O ChatGPT disse:\n'+executable+'\nCopiar\nResposta concluída';
  const cleaned=preserveProviderWhitespace(input,[
    /^(Copiar|Resposta concluída)$/i
  ]);
  assert.equal(cleaned,'O ChatGPT disse:\n'+executable);
  assert.ok(cleaned.includes('\n    for row in rows:\n'));
  assert.ok(cleaned.includes('\n\nif __name__ == "__main__":'));
});

test('nested YAML, legitimate spaces and multiline JSON remain unchanged',()=>{
  const raw='boot:\n  health:\n    deadline_ms: 30000\n\n  mcp:\n    capability_digest: null';
  assert.equal(preserveProviderWhitespace(raw),raw);
  const nested='{\n  "payload": {\n    "accepted": true\n  }\n}';
  assert.equal(preserveProviderWhitespace(nested),nested);
});

test('DOM extractor and body fallback use the same shared whitespace policy',()=>{
  assert.match(worker,/import \{ preserveProviderWhitespace \} from/);
  assert.match(worker,/return preserveProviderWhitespace\(raw,noise\)/);
  assert.match(worker,/preserveWhitespace = \$\{preserveProviderWhitespace\.toString\(\)\}/);
  assert.match(worker,/text = preserveWhitespace\(text,/);
  assert.doesNotMatch(worker,/\.map\(line\s*=>\s*line\.trim\(\)\)/);
});

test('preserved Python source actually executes on Linux CI',t=>{
  if(process.platform==='win32')return t.skip('Python is not installed on the test desktop');
  const code=preserveProviderWhitespace(executable);
  const executed=spawnSync('python3',['-I','-c',code],{encoding:'utf8',timeout:5000});
  assert.equal(executed.status,0,executed.stderr||executed.error?.message);
  assert.equal(executed.stdout.trim(),'5');
});
