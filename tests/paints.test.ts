import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {paintAdvice} from '../src/paints/advice';import {paintCatalogueSchema,type PaintCatalogue,type PaintSku} from '../src/paints/model';
import {readPaintCatalogue,PAINT_GROUP_QUERY,PAINT_PAGE_QUERY,PAINT_RULE_QUERY,type PaintTransport} from '../src/paints/source';import {PaintService} from '../src/paints/service';import {commandSchema} from '../src/main/commands';import {basePledge} from './fixtures';
const at='2026-11-18T00:00:00Z',now=Date.parse(at);
const sku=(id:string,names:string[],minor=1000,extra:Partial<PaintSku>={}):PaintSku=>({id,productId:'268',title:'Synthetic '+id,minQty:1,maxQty:1000,regularMinor:minor,discountedMinor:null,allowCredit:true,available:true,vip:false,warbond:false,hasShips:false,isPackage:names.length>1,contents:names.map(name=>({code:'Paint_'+name,name,kind:'SKIN',hasGamePurchase:false})),...extra});
const catalogue=(skus:PaintSku[],withRule=false):PaintCatalogue=>({schemaVersion:1,source:'rsi-public-paints',fetchedAt:at,currency:'USD',taxBasis:'net',skus,rules:withRule?[{id:1,from:2,to:null,percent:15,amountOff:null,maximum:null,products:['268'],skus:[]}]:[]});
const owned=(id:string,names:string[],minor=2000)=>{const p=basePledge(id);p.name='Synthetic paint '+id;p.ships=[];p.sourceValues={date:'2025-11-01',items:JSON.stringify(names.map(title=>({title,kind:'Skin'}))),alsoContains:'[]',pledgeValue:'$'+(minor/100).toFixed(2)+' USD',meltable:'true'};return {pledge:p,source:'rsi-dom-probe/1'};};
test('Paint comparison uses exact complete contents, supports pack splitting and does not mutate inventory',()=>{
 const rows=[owned('pack',['A','B'],2500)],data=catalogue([sku('1',['A','B'],1800),sku('2',['A']),sku('3',['B'])],true),before=JSON.stringify({rows,data});
 const r=paintAdvice(rows,data,now);assert.equal(r.ready,1);assert.equal(r.totalReplacementMinor,1700);assert.equal(r.totalFreeMinor,800);assert.equal(r.percent,15);assert.equal(r.rows[0]!.replacement.length,2);assert.equal(r.approximate,true);assert.equal(JSON.stringify({rows,data}),before);
});
test('Duplicate colors and repeated pledges preserve copy counts and never inflate a discount tier',()=>{
 const data=catalogue([sku('1',['A'])],true),r=paintAdvice([owned('one',['A']),owned('two',['A'])],data,now);assert.equal(r.ready,2);assert.equal(r.totalReplacementMinor,2000);assert.equal(r.percent,0);
 const pack=paintAdvice([owned('pack',['A','A'],2500)],data,now);assert.equal(pack.rows[0]!.paintCount,2);assert.equal(pack.rows[0]!.replacementMinor,2000);assert.match(pack.rows[0]!.replacement[0]!,/^2 ×/);
});

test('Paint age check accepts real RSI Created labels while retaining recent and invalid date exclusions',()=>{
 const older=owned('older',['A']),recent=owned('recent',['A']),invalid=owned('invalid',['A']);
 older.pledge.sourceValues.date='Created: November 1, 2025';recent.pledge.sourceValues.date='Created: November 17, 2026';invalid.pledge.sourceValues.date='Created: February 30, 2025';
 const result=paintAdvice([older,recent,invalid],catalogue([sku('1',['A'])]),now);
 assert.equal(result.ready,1);assert.equal(result.rows[0]!.freeMinor,1000);assert.equal(result.unverified,2);assert.ok(result.rows.slice(1).every(r=>r.freeMinor===null&&/Frist/.test(r.reason)));
});
test('Ships, game packages, CCUs, extra equipment and free rewards are excluded, even when paint names match',()=>{
 const ship=owned('ship',['A']);ship.pledge.ships=basePledge().ships;
 const game=owned('game',['A']);game.pledge.sourceValues.alsoContains=JSON.stringify([{title:'Star Citizen Digital Download'}]);
 const extra=owned('extra',['A']);extra.pledge.sourceValues.items=JSON.stringify([{title:'A',kind:'Skin'},{title:'Helmet',kind:'FPS Equipment'}]);
 const ccu=owned('upgrade',['A']);ccu.pledge.sourceValues.upgradeState='unresolved';const reward=owned('reward',['A'],0);
 const r=paintAdvice([ship,game,extra,ccu,reward],catalogue([sku('1',['A'])]),now);assert.equal(r.excluded,5);assert.equal(r.ready,0);assert.equal(r.totalFreeMinor,null);assert.ok(r.rows.every(r=>r.freeMinor===null));
 assert.deepEqual(r.rows.map(row=>row.protection),['ship-package','mixed-contents','mixed-contents','mixed-contents',null]);assert.ok(r.rows.filter(row=>row.protection).every(row=>row.replacement.length===0&&row.replacementMinor===null));
});
test('Missing reclaim permission, unknown values and recent source dates never become confirmed savings',()=>{
 const unknown=owned('unknown',['A']);delete unknown.pledge.sourceValues.meltable;
 const price=owned('price',['A']);price.pledge.sourceValues.pledgeValue='999';
 const recent=owned('recent',['A']);recent.pledge.sourceValues.date='2026-11-17';
 const foreign=owned('file',['A']);foreign.source='sarevocs-json/1';
 const r=paintAdvice([unknown,price,recent,foreign],catalogue([sku('1',['A'])]),now);assert.equal(r.unverified,4);assert.equal(r.ready,0);assert.ok(r.rows.every(row=>row.freeMinor===null));assert.match(r.rows[2]!.reason,/Frist/);
});
test('Unavailable, cash-only, VIP, game-grant and ambiguous same-name replacements cannot be recommended',()=>{
 const forbidden=[sku('1',['A'],1,{available:false}),sku('2',['A'],1,{allowCredit:false}),sku('3',['A'],1,{vip:true}),sku('4',['A'],1,{warbond:true}),sku('5',['A'],1,{hasShips:true})];
 const r=paintAdvice([owned('a',['A'])],catalogue(forbidden),now);assert.equal(r.excluded,1);assert.equal(r.totalFreeMinor,null);
 const a=sku('6',['A']),b=sku('7',['A']);b.contents[0]!.code='Different_variant';const ambiguous=paintAdvice([owned('a',['A'])],catalogue([a,b]),now);assert.equal(ambiguous.unverified,1);assert.match(ambiguous.rows[0]!.reason,/nicht eindeutig/);
});
test('Pack discounts are not blindly stacked and a disappearing tier is recomputed after excluding losing rows',()=>{
 const discounted=sku('1',['A','B'],2000,{discountedMinor:1000}),r=paintAdvice([owned('pack',['A','B'],3000)],catalogue([discounted],true),now);assert.equal(r.totalReplacementMinor,1000);assert.equal(r.totalFreeMinor,2000);assert.equal(r.percent,0);
 const lose=paintAdvice([owned('a',['A'],950),owned('b',['B'],700)],catalogue([sku('2',['A']),sku('3',['B'])],true),now);assert.equal(lose.ready,0);assert.equal(lose.totalFreeMinor,null);assert.ok(lose.rows.every(row=>row.state==='no-benefit'));
});
test('Old or future public data does not support a savings result; empty or malformed contents do not invent paints',()=>{
 const data=catalogue([sku('1',['A'])]);data.fetchedAt='2026-11-16T00:00:00Z';assert.equal(paintAdvice([owned('a',['A'])],data,now).ready,0);
 data.fetchedAt='2026-11-19T00:00:00Z';assert.equal(paintAdvice([owned('a',['A'])],data,now).ready,0);
 const p=owned('a',['A']);p.pledge.sourceValues.items='{';assert.equal(paintAdvice([p],null,now).rows.length,0);
});
test('Replacement quantities honor shop limits across pledges and do not bypass limits by splitting checkout',()=>{
 const limited=sku('1',['A'],1000,{maxQty:1}),r=paintAdvice([owned('one',['A']),owned('two',['A'])],catalogue([limited],true),now);assert.equal(r.ready,0);assert.equal(r.totalFreeMinor,null);assert.ok(r.rows.every(row=>/Ersatzmenge/.test(row.reason)));
 const minimum=paintAdvice([owned('one',['A'])],catalogue([sku('2',['A'],1000,{minQty:2})]),now);assert.equal(minimum.ready,0);
 const free=paintAdvice([owned('one',['A'])],catalogue([sku('3',['A'],0)]),now);assert.equal(free.ready,0);
 const promotion=paintAdvice([owned('one',['A'])],catalogue([sku('4',['A'],1000,{discountedMinor:0})]),now);assert.equal(promotion.ready,0);
});
const publicItem=(id:string)=>({id,productId:'268',title:'Synthetic '+id,minQty:1,maxQty:1000,allowCredit:true,hasShips:false,isPackage:false,isWarbond:false,isVip:false,nativePrice:{amount:1000,discounted:null},stock:{available:true},gameItems:[{code:'Paint_A',name:'A',kind:'SKIN',hasGamePurchase:false}]});
const wrapped=(store:unknown)=>({data:{store}});
test('Public reader validates complete one-based pagination and sends only public identifiers to immutable queries',async()=>{
 const calls:{query:string;variables:Record<string,unknown>}[]=[];
 const read:PaintTransport=async(query,variables)=>{calls.push({query,variables});if(query===PAINT_GROUP_QUERY)return wrapped({listing:{count:1,totalCount:1,resources:[{id:'268',type:'paints'}]}});if(query===PAINT_RULE_QUERY)return wrapped({dynamicDiscounts:[]});return wrapped({context:{pricing:{currencyCode:'EUR',exponent:2,exchangeRate:8800,taxInclusive:true}},listing:{count:1,totalCount:2,resources:[publicItem(String(variables.page))]}});};
 const r=await readPaintCatalogue(new AbortController().signal,read,()=>at);assert.equal(r.skus.length,2);assert.deepEqual(calls.filter(c=>c.query===PAINT_PAGE_QUERY).map(c=>c.variables.page),[1,2]);assert.equal(calls.length,4);assert.ok(calls.every(c=>c.query.startsWith('query ')&&!/\b(mutation|cart|reclaim|billing)\b/i.test(c.query)));assert.deepEqual(calls[1]!.variables,{page:1,products:['268']});
});
test('Duplicate pages, changed totals, GraphQL errors and unrecognized currency metadata reject incomplete snapshots',async()=>{
 for(const problem of ['duplicate','changed','errors','currency']){
  const read:PaintTransport=async(query,v)=>{if(query===PAINT_GROUP_QUERY)return wrapped({listing:{count:1,totalCount:1,resources:[{id:'268',type:'paints'}]}});if(problem==='errors')return {errors:[{message:'SYNTHETIC'}]};return wrapped({context:{pricing:{currencyCode:problem==='currency'?'UNKNOWN':'USD',exponent:2,exchangeRate:10000,taxInclusive:false}},listing:{count:1,totalCount:problem==='changed'&&v.page===2?3:2,resources:[publicItem(problem==='duplicate'?'1':String(v.page))]}});};
  await assert.rejects(readPaintCatalogue(new AbortController().signal,read,()=>at));
 }
});
test('Paint cache coalesces refresh, retains last valid data after failure and avoids new reads after immediate close',async()=>{
 const dir=path.resolve('work/temp/paint-service-tests',randomUUID());let count=0,fail=false;const data=catalogue([sku('1',['A'])]);
 const service=new PaintService(dir,async()=>{count++;if(fail)throw Error('SYNTHETIC');return data;});const a=service.refresh(),b=service.refresh();assert.equal(a,b);await a;assert.equal(count,1);assert.deepEqual(service.snapshot().data,data);
 const before=fs.readFileSync(path.join(dir,'paints-v1.json'));fail=true;await service.refresh();assert.deepEqual(service.snapshot().data,data);assert.deepEqual(fs.readFileSync(path.join(dir,'paints-v1.json')),before);assert.ok(service.snapshot().error);service.close();
 let closedReads=0;const closed=new PaintService(path.join(dir,'closed'),async()=>{closedReads++;return data;});const pending=closed.refresh();closed.close();await pending;assert.equal(closedReads,0);assert.equal(closed.snapshot().data,null);
});
test('Paint commands accept no query, token, price, account or action supplied by the renderer',()=>{
 for(const action of ['paints.status','paints.refresh']){assert.equal(commandSchema.safeParse({action}).success,true);for(const field of ['url','query','token','price','accountId'])assert.equal(commandSchema.safeParse({action,[field]:'SYNTHETIC'}).success,false);}
 for(const action of ['paints.buy','paints.reclaim','paints.cart','paints.confirm'])assert.equal(commandSchema.safeParse({action}).success,false);
 assert.equal(paintCatalogueSchema.safeParse({...catalogue([sku('1',['A'])]),skus:[sku('1',['A']),sku('1',['B'])]}).success,false);
});
