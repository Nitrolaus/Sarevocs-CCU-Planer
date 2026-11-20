import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import { LOANER_ARTICLES, parseLoanerArticle, type LoanerSource, type LoanerCache } from '../src/loaners/model';
import { deriveLoaners } from '../src/loaners/derive';import { LoanerService } from '../src/loaners/service';
import { commandSchema } from '../src/main/commands';import { prepareChains } from '../src/planner/chain';import { basePledge } from './fixtures';
import { parseImport } from '../src/importers/files';

const now = () => new Date().toISOString();
function article(source: LoanerSource, rows: string[][], updated = '2026-10-01T00:00:00Z') {
  const spec = LOANER_ARTICLES[source], headers = source === 'loaners' ? ['YOUR SHIP','OUR LOANER(S)'] : ['Parent Ship','Included Vessel'];
  return { article: { id: spec.id, title: spec.title, locale: 'en-us', html_url: spec.url, updated_at: updated,
    body: '<table><thead><tr>' + headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table>' } };
}
const matrixRows = [['Expanse','Prospector, Reliant Kore'],['Odyssey','Carrack, Reliant Kore'],['Carrack / Carrack Expedition','C8 Pisces, URSA Rover'],['600i Explorer and Executive','Cyclone'],['Dragonfly','Mustang Alpha'],['Hull D, E','Hull C, Hercules C2']];
const includedRows = [['Carrack','C8 Pisces, URSA Rover'],['600i Explorer','G12* (currently Cyclone)']];
const cache = (): LoanerCache => ({ schemaVersion:1, loaners:parseLoanerArticle('loaners',article('loaners',matrixRows)),included:parseLoanerArticle('included',article('included',includedRows)) });
function pledge(model: string, id = 'synthetic-'+model) { const p = basePledge(id); p.name = 'Original Hornet package'; p.ships[0]!.modelName=model; return p; }
function directory() { const root=path.resolve('work/temp/loaner-unit');fs.mkdirSync(root,{recursive:true});return fs.mkdtempSync(path.join(root,'case-')); }

test('Bounded public article tables keep source dates, formatting and explicit current replacements',()=>{
  const data=parseLoanerArticle('included',article('included',[['600i Explorer','<strong>G12*</strong> (currently Cyclone)']]));
  assert.equal(data.articleId,LOANER_ARTICLES.included.id);assert.equal(data.updatedAt,'2026-10-01T00:00:00Z');
  assert.deepEqual(data.rows[0]!.children,[{name:'Cyclone',replaces:'G12'}]);
  assert.equal(parseLoanerArticle('loaners',article('loaners',[['Idris-M &amp; P','MPUV Passenger']])).rows[0]!.parent,'Idris-M & P');
});
test('Wrong articles, challenges, changed tables, duplicates and unsafe markup cannot replace valid rules',()=>{
  const good=article('loaners',matrixRows);
  for(const change of [{id:4},{title:'Other'},{locale:'de'},{html_url:'https://example.invalid'},{updated_at:'2099-01-01T00:00:00Z'},{body:'<html>Challenge</html>'},
    {body:good.article.body.replace('YOUR SHIP','Your purchase')},{body:good.article.body.replace('<td>Expanse','<td><img src="https://example.invalid">Expanse')},
    {body:good.article.body.replace('<td>Expanse','<td colspan="2">Expanse')},{body:good.article.body+good.article.body}]) assert.throws(()=>parseLoanerArticle('loaners',{article:{...good.article,...change}}));
  assert.throws(()=>parseLoanerArticle('loaners',article('loaners',[['Expanse','Prospector'],['Expanse','Other']])));
});
test('Use current upgraded models, deduplicate a loaner and retain every granting pledge',()=>{
  const pledges=[pledge('Expanse'),pledge('Odyssey'),pledge('Expanse','second-expanse')],before=JSON.stringify(pledges);
  const result=deriveLoaners(pledges,cache());assert.equal(result.rows.length,3);
  assert.deepEqual(result.rows.find(r=>r.name==='Reliant Kore')!.origins.map(o=>o.parent),['Expanse','Odyssey','Expanse']);
  assert.equal(result.rows.find(r=>r.name==='Prospector')!.origins.length,2);assert.equal(JSON.stringify(pledges),before);
  assert.equal(result.rows.some(r=>r.origins.some(o=>o.parent==='Original Hornet package')),false);
});
test('Own ships with the same model remain separate; no recursive loaners from loaners',()=>{
  const p=[pledge('Expanse'),pledge('Prospector'),pledge('Odyssey')],r=deriveLoaners(p,cache());
  assert.equal(r.rows.find(x=>x.name==='Prospector')!.alsoOwned,true);assert.equal(r.rows.some(x=>x.name==='C8 Pisces'),false);
  assert.equal(p.length,3);assert.equal(prepareChains(p,[],[],false).bases.length,3);
});
test('Included craft override duplicate matrix grants; not-yet-ready G12 remains a temporary Cyclone',()=>{
  const r=deriveLoaners([pledge('Carrack'),pledge('600i Explorer')],cache());assert.equal(r.rows.length,3);
  assert.equal(r.rows.find(x=>x.name==='C8 Pisces')!.origins[0]!.kind,'included');
  const replacement=r.rows.find(x=>x.name==='Cyclone')!;assert.equal(replacement.origins[0]!.kind,'loaner');assert.equal(replacement.origins[0]!.replaces,'G12');assert.equal(r.rows.some(x=>x.name==='G12'),false);
});
test('Unused CCUs, unresolved upgrades, explicit loaners and included children never grant loaners',()=>{
  const ccu=pledge('Expanse');ccu.ccus=[{instanceId:'synthetic',from:'Aurora',to:'Expanse',status:'unused',applicability:'unverified',insurance:ccu.insurance}];
  const unresolved=pledge('Odyssey');unresolved.sourceValues.upgradeState='unresolved';
  const loan=pledge('Carrack');loan.ships[0]!.role='loaner';const included=pledge('600i Explorer');included.ships[0]!.role='included';
  assert.deepEqual(deriveLoaners([ccu,unresolved,loan,included],cache()).rows,[]);
  assert.equal(prepareChains([loan,included],[],[],false).bases.length,0);
});
test('Exact documented family variants are supported without fuzzy or substring identity guesses',()=>{
  const data=cache(),r=deriveLoaners([pledge('Dragonfly'),pledge('Hull E')],data);
  assert.deepEqual(r.rows.map(x=>x.name),['Hercules C2','Hull C','Mustang Alpha']);
  assert.deepEqual(deriveLoaners([pledge('Dragonfly Star Kitten'),pledge('Dragonfly Black'),pledge('Dragonfly Yellowjacket')],data).rows,[]);
  assert.deepEqual(deriveLoaners([pledge('Dragonfly Mystery'),pledge('Hull Elite'),pledge('Expans')],data).rows,[]);
  data.loaners.rows.push({parent:'New Variants',children:[{name:'Example',replaces:null}]});assert.equal(deriveLoaners([pledge('New')],data).partialRules,true);
});
test('Giveaway ownership and a published Stingray rule never prove a Starfarer allocation',()=>{
  const data=cache();data.loaners.rows.push({parent:'S-65 Stingray',children:[{name:'Starfarer',replaces:null}]});
  const gift=pledge('S-65 Stingray');gift.name='SYNTHETIC GIVEAWAY';gift.sourceValues.acquisition='giveaway';gift.sourceValues.loanerConfirmed='true';gift.ships[0]!.identity='confirmed';
  const before=JSON.stringify(gift),r=deriveLoaners([gift],data);assert.equal(r.rows.length,1);
  assert.equal(r.rows[0]!.name,'Starfarer');assert.equal(r.rows[0]!.accountVerification,'unconfirmed');assert.equal(r.rows[0]!.origins[0]!.publishedParent,'S-65 Stingray');
  assert.equal(JSON.stringify(gift),before);assert.equal(gift.ships[0]!.modelName,'S-65 Stingray');
  assert.ok(deriveLoaners([pledge('Expanse'),pledge('Carrack')],data).rows.every(row=>row.accountVerification==='unconfirmed'));
});
test('RSI Carrack C8X spellings with and without a space after w/ identify the same explicit variant',()=>{
  const data=cache();data.included.rows=[{parent:'Carrack Expedition w/ C8X',children:[{name:'C8X Pisces Expedition',replaces:null}]}];
  for(const model of ['Carrack Expedition w/ C8X','Carrack Expedition w/C8X']){
    const r=deriveLoaners([pledge(model)],data);assert.equal(r.partialRules,false);assert.equal(r.rows.length,1);assert.equal(r.rows[0]!.name,'C8X Pisces Expedition');
  }
  assert.deepEqual(deriveLoaners([pledge('Carrack Expedition')],data).rows.map(r=>r.name),['C8 Pisces','URSA Rover']);
});
test('Game-access evidence stays conditional and input/profile results cannot contaminate each other',()=>{
  const a=pledge('Expanse'),b=pledge('Odyssey');a.sourceValues.items=JSON.stringify([{title:'Star Citizen Digital Download'}]);
  assert.equal(deriveLoaners([a],cache()).gameAccessObserved,true);assert.equal(deriveLoaners([b],cache()).gameAccessObserved,false);
  assert.deepEqual(deriveLoaners([],cache()).rows,[]);assert.deepEqual(deriveLoaners([a],null).rows,[]);
});
test('The distributed loaner demo imports as synthetic and derives five additional entries without changing its three ships',()=>{
  const parsed=parseImport(fs.readFileSync('tests/fixtures/loaner-inventory.json','utf8'));
  assert.equal(parsed.document.dataMode,'demo');assert.equal(parsed.document.pledges.length,3);
  const result=deriveLoaners(parsed.document.pledges,cache());assert.equal(result.rows.length,5);assert.equal(result.gameAccessObserved,true);
  assert.equal(parsed.document.pledges.flatMap(p=>p.ships).length,3);assert.equal(parsed.document.pledges.flatMap(p=>p.ccus).length,0);
});
test('Both sources are atomically cached; a failure, backwards date or corrupt file preserves usable data',async()=>{
  const dir=directory();let fail=false,old=false;const s=new LoanerService(dir,async source=>{
    if(source!=='loaners'&&source!=='included')throw Error('Unexpected source');if(fail&&source==='included')throw Error('Synthetic failure');
    return article(source,source==='loaners'?matrixRows:includedRows,old?'2025-01-01T00:00:00Z':'2026-10-01T00:00:00Z');});
  await s.refresh();assert.equal(s.snapshot().error,false);const before=fs.readFileSync(path.join(dir,'loaners-v1.json'),'utf8');
  fail=true;await s.refresh();assert.equal(s.snapshot().error,true);assert.equal(fs.readFileSync(path.join(dir,'loaners-v1.json'),'utf8'),before);
  fail=false;old=true;await s.refresh();assert.equal(fs.readFileSync(path.join(dir,'loaners-v1.json'),'utf8'),before);s.close();
  const restored=new LoanerService(dir,async()=>{throw Error('Offline');});assert.equal(restored.snapshot().data!.loaners.rows.length,matrixRows.length);restored.close();
  fs.writeFileSync(path.join(dir,'loaners-v1.json'),'{bad');const damaged=new LoanerService(dir,async()=>null);assert.equal(damaged.snapshot().error,true);assert.equal(damaged.snapshot().data,null);damaged.close();
});
test('Refreshes coalesce, close cancels both readers and late responses never write',async()=>{
  const dir=directory(),pending:{source:LoanerSource;signal:AbortSignal;resolve:(x:unknown)=>void}[]=[];
  const s=new LoanerService(dir,(source,signal)=>new Promise(resolve=>pending.push({source:source as LoanerSource,signal,resolve})));
  const first=s.refresh();assert.equal(s.refresh(),first);s.close();assert.ok(pending.every(x=>x.signal.aborted));
  for(const p of pending)p.resolve(article(p.source,p.source==='loaners'?matrixRows:includedRows));await first;assert.deepEqual(fs.readdirSync(dir),[]);assert.equal(s.snapshot().data,null);
});
test('Loaner commands are fixed and fieldless, with no account, URL, cookie, token or purchase payload',()=>{
  for(const action of ['loaners.status','loaners.refresh']){assert.equal(commandSchema.safeParse({action}).success,true);for(const key of ['url','accountId','cookie','token','purchase'])assert.equal(commandSchema.safeParse({action,[key]:'synthetic'}).success,false);}
});
