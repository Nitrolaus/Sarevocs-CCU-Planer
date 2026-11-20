import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';import {build} from 'esbuild';
const folder=path.resolve('work/temp/loaner-sources',randomUUID());fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,'harness.cjs');
await build({entryPoints:['tests/loaner-source-harness.ts'],outfile:file,bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron']});
const env={...process.env,TEMP:path.join(folder,'tmp'),TMP:path.join(folder,'tmp')};fs.mkdirSync(env.TEMP,{recursive:true});delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
const result=spawnSync(createRequire(import.meta.url)('electron'),[file,'--probe-dir='+folder,'--disable-gpu','--disable-background-networking'],{env,windowsHide:true,encoding:'utf8',timeout:45000});
if(result.stdout)console.log(result.stdout.trim());if(result.status!==0)throw Error('PUBLIC_LOANER_PROBE_FAILED; report: '+folder);console.log('REPORT: '+path.join(folder,'results.json'));
