import type {AccountInventory,Pledge} from '../../src/domain/model';
import type {MarketSnapshot} from '../../src/market/model';
import type {PricingSnapshot} from '../../src/pricing/model';
import type {ReportInput} from '../../src/export/document';
import {prepareChains} from '../../src/planner/chain';
import {approveStartBase,withStartBase} from '../../src/planner/bases';
import {chainVariants} from '../../src/planner/manual';
import {emptyDraft,anchorFromStep} from '../../src/planner/draft';
export const reportAccountId='11111111-1111-4111-8111-111111111111';
export function reportFixture():ReportInput{
 const at=new Date().toISOString(),base=(id:string,name:string):Pledge=>({pledgeId:id,name,insurance:{kind:'lti',evidence:'Synthetic'},originalDescription:'SECRET_NOT_FOR_REPORT',ships:[],ccus:[],protected:true,baseReleased:false,restrictions:[],acquisitionCost:null,unknownCostReason:'Synthetic unknown',meltValue:null,sourceValues:{session:'SECRET_NOT_FOR_REPORT',date:'November 18, 2026'}});
 const token=base('100','SYNTHETIC LTI token');token.ships=[{childId:'ship',modelName:'Starter',modelId:null,identity:'unresolved',role:'unverified'}];token.acquisitionCost={minor:4000,currency:'USD',taxBasis:'net',evidence:'Synthetic receipt'};
 const ccu=base('200','SYNTHETIC WARBOND A to B');ccu.ccus=[{instanceId:'ccu',from:'A',to:'B',status:'unused',applicability:'unverified',insurance:{kind:'unknown',reason:'Base applies'}}];ccu.acquisitionCost={minor:500,currency:'USD',taxBasis:'net',evidence:'Synthetic receipt'};
 const pack=base('300','=HYPERLINK("https://example.invalid","NOT A FORMULA")');pack.ships=[{...token.ships[0]!,childId:'s1',modelName:'B'},{...token.ships[0]!,childId:'s2',modelName:'A'}];pack.acquisitionCost={minor:10000,currency:'EUR',taxBasis:'gross',evidence:'Synthetic package receipt'};
 const inventory:AccountInventory={account:{id:reportAccountId,name:'SYNTHETIC EXPORT PROFILE',mode:'real',reference:null,identityKind:null,identityStatus:'unbound',lastComplete:null},items:[token,ccu,pack].map(pledge=>({pledge,availability:'present',source:'rsi-dom-probe/1',importedAt:at})),buybacks:[]};
 const ships=['Starter','A','B','Galaxy','Liberator'].map((name,i)=>({id:i+1,name,chassisId:null,manufacturer:i===3?'Roberts Space Industries':'Synthetic',manufacturerCode:'TEST',status:'unknown',focus:'',length:null}));
 const prices=[4000,10000,20000,40000,57500],offers=ships.map((s,i)=>({key:'test:'+i,name:'Upgrade to '+s.name,targetName:s.name,toShipId:s.id,toSkuId:100+i,regularMinor:prices[i]!,warbondMinor:i===3?37500:null,warbond:i===3,currency:'USD' as const,taxBasis:'net' as const,verification:'target-observation' as const,firstSeenAt:at,lastSeenAt:at,change:'current' as const,previousRegularMinor:null,previousWarbondMinor:null}));
 const market:MarketSnapshot={schemaVersion:1,catalogue:{fetchedAt:at,ships},offers:{fetchedAt:at,sourceAt:at,checkedAt:at,items:offers},pending:false,errors:{catalogue:null,offers:null},refreshSchedule:{hour:17,timeZone:'Europe/Berlin'}};
 const display:PricingSnapshot={settings:{schemaVersion:1,language:'de',currency:'EUR',taxMode:'net',vatBasisPoints:1900},configured:true,settingsError:false,rate:{source:'ECB',sourceDate:at.slice(0,10),fetchedAt:at,usdPerEurMicros:1250000},pending:false,rateError:false};
 const pool=prepareChains([token,ccu,pack],ships,offers,true),b=pool.bases.find(b=>b.pledgeId==='100')!,draft=approveStartBase(pool,emptyDraft(),b.key),plan=chainVariants(withStartBase(pool,b.key),ships[3]!,offers,true,b.key)[0]!;
 return {kind:'inventory',inventory,observed:null,market,display,now:at,chain:{targetId:4,draft:{...draft,mode:'manual',initialized:true,anchors:plan.steps.map(anchorFromStep)},preview:true},targets:[4,5,null],drafts:new Map()};
}
