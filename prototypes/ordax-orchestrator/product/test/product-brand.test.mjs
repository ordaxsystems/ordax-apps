import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRODUCT_NAME, PRODUCT_SHORT_NAME} from '../src/product-brand.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const packageLock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));

test('commercial brand SSOT matches Electron package and static HTML entry',()=>{
  assert.equal(PRODUCT_NAME,'OrdaX Forge');
  assert.equal(PRODUCT_SHORT_NAME,'Forge');
  assert.equal(packageJson.build.productName,PRODUCT_NAME);
  const html=fs.readFileSync(path.join(root,'desktop','ui.html'),'utf8');
  assert.match(html,new RegExp('<title>'+PRODUCT_NAME+'</title>'));
  assert.match(html,new RegExp('id="productNameHeader">'+PRODUCT_NAME+'</h1>'));
  assert.match(html,new RegExp('id="productNameSettings">'+PRODUCT_NAME+'</h3>'));
});
test('Forge owns its sole executable, appId and private user profile',()=>{
  assert.equal(packageJson.name,'ordax-forge');
  assert.equal(packageLock.name,packageJson.name);
  assert.equal(packageLock.packages[''].name,packageJson.name);
  assert.equal(packageJson.build.appId,'br.com.ordax.forge');
  // The canonical OrdaX Runtime launcher verifies the Forge executable name.
  assert.equal(packageJson.build.win.executableName,'OrdaX Forge');
  assert.equal(packageJson.build.win.artifactName,'OrdaX-Forge-${version}.exe');
  const binding=fs.readFileSync(path.join(root,'src','lab-profile-binding.mjs'),'utf8');
  assert.match(binding,/path\.join\(localAppData,'OrdaX','Forge'\)/);
  const main=fs.readFileSync(path.join(root,'desktop','main.mjs'),'utf8');
  assert.match(main,/app\.setName\(PRODUCT_NAME\)/);
  assert.match(main,/dataRoot, 'ordax-forge\.sqlite'/);
});
