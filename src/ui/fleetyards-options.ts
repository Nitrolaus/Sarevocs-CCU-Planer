import {fleetOptionsSchema,type FleetOptions} from '../export/fleetyards';

export type PriceDraft={mode:'inherit'|'hidden'|'known'|'custom';amount:string;currency:'USD'|'EUR'|'GBP'};
export type DateDraft={mode:'inherit'|'hidden'|'known'|'custom';value:string};
export type ShipDraft={price:PriceDraft;date:DateDraft};
export const emptyPrice=(mode:PriceDraft['mode']='inherit'):PriceDraft=>({mode,amount:'',currency:'USD'});
export const emptyDate=(mode:DateDraft['mode']='inherit'):DateDraft=>({mode,value:''});
export const emptyShipDraft=():ShipDraft=>({price:emptyPrice(),date:emptyDate()});

/** Empty/incomplete edits never become an accidental zero or a disclosure of the original. */
export function fleetDraftOptions(price:PriceDraft,date:DateDraft,ships:ReadonlyMap<string,ShipDraft>,flags:{includeLti:boolean;includeWarbond:boolean;includePackageNames:boolean}):
 {ok:true;options:ReturnType<typeof fleetOptionsSchema.parse>}|{ok:false;field:'price'|'date';key?:string}{
 function priceValue(draft:PriceDraft){
  if(draft.mode==='inherit')return undefined;
  if(draft.mode!=='custom')return {mode:draft.mode};
  const match=/^(0|[1-9]\d{0,6})(?:[.,](\d{1,2}))?$/.exec(draft.amount.trim());
  const minor=match?Number(match[1])*100+Number((match[2]??'').padEnd(2,'0')):NaN;
  if(!Number.isSafeInteger(minor)||minor<0||minor>100_000_000)throw 'price';
  return {mode:'custom' as const,value:{minor,currency:draft.currency}};
 }
 function dateValue(draft:DateDraft){
  if(draft.mode==='inherit')return undefined;
  if(draft.mode!=='custom')return {mode:draft.mode};
  const value={mode:'custom' as const,value:draft.value};
  if(!fleetOptionsSchema.safeParse({date:value}).success)throw 'date';
  return value;
 }
 let key:string|undefined;
 try{
  const globalPrice=priceValue(price),globalDate=dateValue(date);
  const overrides=[...ships].map(([shipKey,draft])=>{key=shipKey;return {key:shipKey,price:priceValue(draft.price),date:dateValue(draft.date)}})
   .filter(row=>row.price||row.date);
  const parsed=fleetOptionsSchema.safeParse({...flags,price:globalPrice,date:globalDate,overrides} satisfies FleetOptions);
  if(!parsed.success)throw 'price';
  return {ok:true,options:parsed.data};
 }catch(field){return {ok:false,field:field==='date'?'date':'price',...(key?{key}:{})};}
}
