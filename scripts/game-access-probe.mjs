import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';import {build} from 'esbuild';
const folder=path.resolve('work/temp/game-access-probe',randomUUID());fs.mkdirSync(folder,{recursive:true});const harness=path.join(folder,'harness.cjs');
await build({entryPoints:['tests/game-access-probe-harness.ts'],outfile:harness,bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron']});
const env={...process.env,TEMP:path.join(folder,'tmp'),TMP:path.join(folder,'tmp')};fs.mkdirSync(env.TEMP,{recursive:true});delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
const child=spawn(createRequire(import.meta.url)('electron'),[harness,'--report-dir='+folder,'--disable-gpu','--disable-background-networking'],{env,windowsHide:true,stdio:'inherit'});process.exitCode=await new Promise(resolve=>child.on('exit',code=>resolve(code??1)));
