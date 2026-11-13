import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {
  FORGE_TUNNEL_ZIP_URL,FORGE_TUNNEL_ZIP_SHA256,
  downloadForgeOfficialTunnelArchive,installPinnedForgeTunnelArchive,
  installForgeOfficialTunnelClient
} from '../src/forge-mcp-tunnel-installer.mjs';

const sha=data=>createHash('sha256').update(data).digest('hex');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'forge-mcp-install-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const zip=Buffer.from('synthetic zip fixture, no external access');
  const exe=Buffer.from('synthetic executable fixture, never run');
  const targetDirectory=path.join(root,'components','v0.0.20');
  const downloads=[];
  return {
    root,zip,exe,targetDirectory,downloads,
    input:{
      targetDirectory,expectedZipSha256:sha(zip),expectedExeSha256:sha(exe),
      download:async(url,destination)=>{
        downloads.push(url);fs.writeFileSync(destination,zip,{flag:'wx'});
      },
      extract:async(archive,destination)=>{
        assert.equal(fs.readFileSync(archive).equals(zip),true);
        const folder=path.join(destination,'release');
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder,'tunnel-client.exe'),exe);
      }
    }
  };
}
test('install verifies both pinned bytes and atomically publishes one local component',async t=>{
  const f=fixture(t);
  const receipt=await installPinnedForgeTunnelArchive(f.input);
  assert.equal(receipt.installed,true);
  assert.deepEqual(f.downloads,[FORGE_TUNNEL_ZIP_URL]);
  assert.equal(fs.readFileSync(path.join(f.targetDirectory,'tunnel-client.exe')).equals(f.exe),true);
  const manifest=JSON.parse(fs.readFileSync(path.join(f.targetDirectory,'release-info.json'),'utf8'));
  assert.equal(manifest.executableSha256,sha(f.exe));
  assert.equal(manifest.archiveSha256,sha(f.zip));
  assert.equal(manifest.verified,true);
  assert.equal(fs.readdirSync(path.dirname(f.targetDirectory)).length,1);
  await assert.rejects(installPinnedForgeTunnelArchive(f.input),
    /existing_install_requires_review/);
});
test('a wrong release checksum is rejected without publishing a client',async t=>{
  const f=fixture(t);
  await assert.rejects(installPinnedForgeTunnelArchive({
    ...f.input,expectedZipSha256:'0'.repeat(64)
  }),/archive_sha256_invalid/);
  assert.equal(fs.existsSync(f.targetDirectory),false);
  assert.deepEqual(fs.readdirSync(path.dirname(f.targetDirectory)),[]);
});
test('wrong executable, unsafe symlinks and duplicate client layout fail closed',async t=>{
  const f=fixture(t);
  await assert.rejects(installPinnedForgeTunnelArchive({
    ...f.input,expectedExeSha256:'f'.repeat(64)
  }),/executable_sha256_invalid/);
  assert.equal(fs.existsSync(f.targetDirectory),false);
  await assert.rejects(installPinnedForgeTunnelArchive({
    ...f.input,extract:async(_,folder)=>{
      fs.writeFileSync(path.join(folder,'tunnel-client.exe'),f.exe);
      fs.mkdirSync(path.join(folder,'subdir'));
      fs.writeFileSync(path.join(folder,'subdir','tunnel-client.exe'),f.exe);
    }
  }),/archive_layout_invalid/);
  assert.equal(fs.existsSync(f.targetDirectory),false);
});
test('download accepts only official HTTPS release origin and bounded bytes',async t=>{
  const f=fixture(t),destination=path.join(f.root,'download.zip');
  await assert.rejects(downloadForgeOfficialTunnelArchive('https://evil.invalid/client.zip',destination),
    /source_invalid/);
  await assert.rejects(downloadForgeOfficialTunnelArchive(FORGE_TUNNEL_ZIP_URL,destination,{
    request:async()=>({status:200,url:'https://evil.invalid/asset',body:{
      async *[Symbol.asyncIterator](){yield Buffer.from('untrusted');}
    }})
  }),/source_unverified/);
  await downloadForgeOfficialTunnelArchive(FORGE_TUNNEL_ZIP_URL,destination,{
    request:async()=>({status:200,url:'https://release-assets.githubusercontent.com/verified',body:{
      async *[Symbol.asyncIterator](){yield f.zip;}
    }})
  });
  assert.equal(fs.readFileSync(destination).equals(f.zip),true);
  assert.equal(FORGE_TUNNEL_ZIP_SHA256.length,64);
});
test('no installation without explicit approval, even before platform checks',async()=>{
  await assert.rejects(installForgeOfficialTunnelClient({ownerApproved:false}),
    /owner_approval_required/);
  await assert.rejects(installForgeOfficialTunnelClient({
    ownerApproved:true,platform:'linux',arch:'x64'
  }),/windows_x64_required/);
});
test('native integration has one explicit install command and no secret persistence',()=>{
  const root=new URL('../',import.meta.url);
  const main=fs.readFileSync(new URL('desktop/main.mjs',root),'utf8');
  const preload=fs.readFileSync(new URL('desktop/preload.cjs',root),'utf8');
  const ui=fs.readFileSync(new URL('desktop/forge-local-mcp-ui.js',root),'utf8');
  const html=fs.readFileSync(new URL('desktop/ui.html',root),'utf8');
  assert.match(main,/registerUiHandler\('ordax:forge:tunnel:install'/);
  assert.match(main,/ownerApproved:true/);
  assert.match(preload,/forgeOfficialTunnelInstall/);
  assert.match(ui,/forgeOfficialTunnelInstall/);
  assert.match(html,/id="forgeOfficialTunnelInstall"/);
  assert.match(html,/data-forge-tunnel-link="tunnels"/);
});
