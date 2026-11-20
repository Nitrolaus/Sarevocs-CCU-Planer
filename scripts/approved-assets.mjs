// Synthetic, offline verification of the approved files and actual renderer.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
const require=createRequire(import.meta.url), root=process.cwd();
const folder=path.resolve('work/temp/approved-assets',randomUUID());fs.mkdirSync(folder,{recursive:true});
const approval=JSON.parse(fs.readFileSync('assets/approved-assets.json','utf8'));
const digest=b=>createHash('sha256').update(b).digest('hex').toUpperCase();
const images=[],checks=[],errors=[];
for(const asset of approval.assets)assert.equal(digest(fs.readFileSync(asset.file)),asset.sha256);
for(const [source,destination] of [['assets/app.png','build/renderer/app.png'],['assets/app.ico','build/app.ico'],['assets/tray.ico','build/tray.ico']])
 assert.equal(digest(fs.readFileSync(source)),digest(fs.readFileSync(destination)));
assert.equal(fs.existsSync('build/renderer/app.svg'),false);
checks.push('All three source/build files match the approved SHA256; no stale SVG in the product.');
const logo=fs.readFileSync('assets/app.png');
images.push({name:'logo',size:1130,png:logo.toString('base64')});
for(const [file,sizes] of [['assets/app.ico',[16,20,24,32,40,48,64,128,256]],['assets/tray.ico',[16,20,24,32,48,64]]]){
 const ico=fs.readFileSync(file);assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),sizes.length);
 let end=6+16*sizes.length;
 for(const [i,size] of sizes.entries()){
  const p=6+16*i, length=ico.readUInt32LE(p+8),offset=ico.readUInt32LE(p+12);
  assert.equal(ico[p]||256,size);assert.equal(ico[p+1]||256,size);assert.equal(offset,end);assert.ok(length>0&&offset+length<=ico.length);
  const png=ico.subarray(offset,offset+length);assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);assert.equal(png[25],6,'RGBA PNG');
  images.push({name:file+':'+size,size,png:png.toString('base64')});end=offset+length;
 }assert.equal(end,ico.length);
}
checks.push('Nine program frames and six tray frames have valid sizes, offsets and true RGBA PNG payloads.');
for(const file of ['index.html','app.js','app.css','app.png','brand.css','kofi-logo.png'])fs.copyFileSync(path.join('build/renderer',file),path.join(folder,file));
fs.cpSync('build/renderer/fonts',path.join(folder,'fonts'),{recursive:true});
for(const [source,destination] of [['tests/fixtures/ship-display-preload.cjs','fixture-preload.cjs'],['tests/fixtures/upgrade-history-ui-main.cjs','fixture-main.cjs']])fs.copyFileSync(source,path.join(folder,destination));
const id='11111111-1111-4111-8111-111111111111',account={id,name:'GRAFIKPRÜFUNG · TESTDATEN',mode:'real',reference:null,identityKind:null,identityStatus:'unbound',lastComplete:null};
fs.writeFileSync(path.join(folder,'fixture.json'),JSON.stringify({state:{accounts:[account],selectedAccountId:id,dataDir:'SYNTHETISCH',version:'GRAFIKPRÜFUNG · TESTDATEN',packaged:false},inventories:{[id]:{account,items:[],buybacks:[]}},views:{}}));
const env={...process.env,TEMP:path.join(folder,'tmp'),TMP:path.join(folder,'tmp')};fs.mkdirSync(env.TEMP,{recursive:true});delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
let application;
try{
 application=await _electron.launch({executablePath:require('electron'),args:[path.join(folder,'fixture-main.cjs'),'--disable-gpu','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--proxy-server=http://127.0.0.1:9'],cwd:root,env});
 const alpha=await application.evaluate(({nativeImage},values)=>values.map(({name,size,png})=>{
  const img=nativeImage.createFromBuffer(Buffer.from(png,'base64'));const {width,height}=img.getSize();
  const pixels=img.toBitmap();let transparent=0,partial=0,opaque=0,edge=0,minX=width,minY=height,maxX=-1,maxY=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const a=pixels[(y*width+x)*4+3];if(a===0)transparent++;else{if(a===255)opaque++;else partial++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);if(!x||!y||x===width-1||y===height-1)edge++;}
  }return {name,size,width,height,transparent,partial,opaque,edge,bounds:{minX,minY,maxX,maxY}};
 }),images);
 fs.writeFileSync(path.join(folder,'alpha.json'),JSON.stringify(alpha,null,2));
 for(const a of alpha){assert.equal(a.width,a.size);assert.equal(a.height,a.size);assert.ok(a.transparent>0&&a.opaque>0,JSON.stringify(a));
  // The approved 16px tray deliberately uses a crisp binary alpha mask.
  if(a.name!=='assets/tray.ico:16')assert.ok(a.partial>0,a.name);
  assert.equal(a.edge,0,a.name);assert.ok((a.bounds.maxX-a.bounds.minX+1)/a.width>=.7,a.name);}
 checks.push('All 16 images decode with real alpha, transparent outer edges and tight bounds; approved 16px tray retains binary alpha.');
 const page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('heading',{name:'Bestand',exact:true}).waitFor();
 await page.evaluate(()=>document.fonts.ready);
 const brand=await page.locator('.brand').evaluate(e=>{const image=e.querySelector('img').getBoundingClientRect(),button=document.querySelector('aside nav button').getBoundingClientRect();return {width:image.width,buttonWidth:button.width,left:image.left-button.left,right:image.right-button.right,align:getComputedStyle(e).textAlign,name:getComputedStyle(e.querySelector('.brand-name')).fontStyle,subtitle:getComputedStyle(e.querySelector('.brand-subtitle')).fontStyle,font:getComputedStyle(e.querySelector('.brand-title')).fontFamily,loaded:document.fonts.check('800 22px "CCU Orbitron"')};});
 assert.equal(brand.width,203);assert.equal(brand.width,brand.buttonWidth);assert.equal(brand.left,0);assert.equal(brand.right,0);assert.equal(brand.align,'center');assert.equal(brand.name,'italic');assert.equal(brand.subtitle,'normal');assert.match(brand.font,/CCU Orbitron/);assert.equal(brand.loaded,true);
 await page.locator('dialog.login-short').evaluate(d=>d.showModal());
 const geometry=await page.locator('.brand img,.desktop-preview img').evaluateAll(nodes=>nodes.map(img=>{const s=getComputedStyle(img),r=img.getBoundingClientRect();return {src:img.getAttribute('src'),loaded:img.complete&&img.naturalWidth>0,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,width:r.width,height:r.height,padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft]};}));
 assert.equal(geometry.length,2);for(const [i,g] of geometry.entries()){assert.equal(g.src,'app.png');assert.equal(g.loaded,true);assert.equal(g.naturalWidth,1130);assert.equal(g.naturalHeight,1130);assert.equal(g.width,i===0?203:48);assert.equal(g.height,i===0?203:48);assert.deepEqual(g.padding,['0px','0px','0px','0px']);}
 assert.equal(await application.evaluate(()=>globalThis.blockedRequests),0);
 assert.equal(await application.evaluate(()=>globalThis.fixture.commands.some(c=>c.action==='rsi.open'||c.action==='rsi.connect')),false);
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(folder,'logo-im-programm-testdaten.png')});
 checks.push('Actual sidebar is exactly menu width, centered Orbitron name italic and subtitle normal; dialog remains 48px. No padding, remote requests or authentication.');
 await page.locator('dialog.login-short').evaluate(d=>d.close());
 for(const height of [1000,700]){await application.evaluate(({BrowserWindow},h)=>BrowserWindow.getAllWindows()[0].setContentSize(1024,h),height);const g=await page.locator('aside').evaluate(e=>({navBottom:e.querySelector('nav').getBoundingClientRect().bottom,footerTop:e.querySelector('footer').getBoundingClientRect().top,scroll:e.scrollHeight,visible:e.clientHeight,overflow:getComputedStyle(e).overflowY}));assert.ok(g.footerTop>=g.navBottom);assert.equal(g.overflow,'auto');}
 checks.push('Sidebar menu and footer do not overlap at minimum window height; sidebar can scroll.');
 fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'PASS',checks,alpha,geometry,errors,userDataRead:false,newRsiLogin:false,installedApplicationStarted:false},null,2));
 console.log('PASS: '+checks.join('\nPASS: '));console.log('REPORT: '+path.join(folder,'results.json'));
}catch(error){fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({status:'FAIL',checks,error:error.message},null,2));console.error('REPORT: '+path.join(folder,'results.json'));throw error;}
finally{if(application){const child=application.process();await application.close();assert.equal(child.exitCode,0);}}
