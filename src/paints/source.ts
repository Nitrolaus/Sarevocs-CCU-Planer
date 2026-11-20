import {paintCatalogueSchema,type PaintCatalogue} from './model';

// Handwritten, immutable public catalogue queries. Never use the authenticated RSI session,
// accept arbitrary GraphQL, read a cart or execute a mutation.
export const PAINT_GROUP_QUERY='query SarevocPaintGroups { store(browse: true, name: "pledge") { listing: search(query: { page: 1, limit: 10, products: { types: ["paints"] } }) { count totalCount resources { id type } } } }';
export const PAINT_PAGE_QUERY='query SarevocPaintPage($page: Int!, $products: [ID!]) { store(browse: true, name: "pledge") { context { pricing { currencyCode exponent exchangeRate taxInclusive } } listing: search(query: { page: $page, limit: 100, skus: { products: $products } }) { count totalCount resources { ... on TySku { id productId title minQty maxQty allowCredit hasShips isPackage isWarbond isVip nativePrice { amount discounted } stock { available } gameItems { code name kind hasGamePurchase } } } } } }';
export const PAINT_RULE_QUERY='query SarevocPaintRules($products: [Int!]) { store(name: "pledge") { dynamicDiscounts(product_ids: $products, search_by: "product_ids") { id percent_off amount_off from_cart_qty to_cart_qty max_value targeted_products targeted_skus } } }';
type Json=Record<string,any>;
export type PaintTransport=(query:typeof PAINT_GROUP_QUERY|typeof PAINT_PAGE_QUERY|typeof PAINT_RULE_QUERY,variables:Record<string,unknown>,signal:AbortSignal)=>Promise<unknown>;
export const publicPaintTransport:PaintTransport=async(query,variables,signal)=>{
 const operationName=query===PAINT_GROUP_QUERY?'SarevocPaintGroups':query===PAINT_PAGE_QUERY?'SarevocPaintPage':query===PAINT_RULE_QUERY?'SarevocPaintRules':null;
 if(!operationName)throw Error('PAINT_QUERY_NOT_ALLOWED');
 const response=await fetch('https://robertsspaceindustries.com/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,operationName,variables}),credentials:'omit',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
 if(!response.ok||Number(response.headers.get('content-length')??0)>8*1024*1024)throw Error('PAINT_SOURCE_UNAVAILABLE');
 const text=await response.text();if(text.length>8*1024*1024)throw Error('PAINT_SOURCE_TOO_LARGE');return JSON.parse(text);
};
function store(raw:unknown):Json {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('PAINT_RESPONSE_INVALID');const value=raw as Json;
 if(value.errors?.length||!value.data?.store||typeof value.data.store!=='object')throw Error('PAINT_RESPONSE_INVALID');return value.data.store;
}
function listing(value:Json,maximum:number):{count:number;totalCount:number;resources:Json[]}{
 const r=value.listing;if(!r||!Number.isInteger(r.count)||!Number.isInteger(r.totalCount)||r.totalCount<1||r.totalCount>maximum||!Array.isArray(r.resources)||r.resources.length!==r.count)throw Error('PAINT_PAGINATION_INVALID');return r;
}
export async function readPaintCatalogue(signal:AbortSignal,read:PaintTransport=publicPaintTransport,now=()=>new Date().toISOString()):Promise<PaintCatalogue>{
 const groups=listing(store(await read(PAINT_GROUP_QUERY,{},signal)),10);
 if(groups.resources.length!==groups.totalCount)throw Error('PAINT_GROUPS_INCOMPLETE');
 const products=groups.resources.map(p=>{if(p.type!=='paints'||typeof p.id!=='string'||!/^\d{1,10}$/.test(p.id)||Number(p.id)<1)throw Error('PAINT_GROUP_INVALID');return p.id;});
 if(new Set(products).size!==products.length)throw Error('PAINT_GROUPS_DUPLICATED');
 let total:number|null=null;const skus:Json[]=[],ids=new Set<string>();
 for(let page=1;page<=30;page++){
  if(signal.aborted)throw Error('PAINT_CANCELLED');
  const current=store(await read(PAINT_PAGE_QUERY,{page,products},signal)),rows=listing(current,3000),pricing=current.context?.pricing;
  if(!pricing||!['USD','EUR','CAD','GBP','AUD'].includes(pricing.currencyCode)||pricing.exponent!==2||typeof pricing.taxInclusive!=='boolean'||!Number.isInteger(pricing.exchangeRate)||pricing.exchangeRate<=0)throw Error('PAINT_PRICE_CONTEXT_INVALID');
  if(total!==null&&rows.totalCount!==total)throw Error('PAINT_CATALOGUE_CHANGED');total=rows.totalCount;
  for(const item of rows.resources){
   if(!products.includes(item.productId)||ids.has(item.id)||!item.nativePrice||!item.stock||!Array.isArray(item.gameItems))throw Error('PAINT_ITEM_INVALID');ids.add(item.id);
   skus.push({id:item.id,productId:item.productId,title:item.title,minQty:item.minQty,maxQty:item.maxQty,regularMinor:item.nativePrice.amount,discountedMinor:item.nativePrice.discounted??null,allowCredit:item.allowCredit===true,available:item.stock.available===true,vip:item.isVip!==false,warbond:item.isWarbond!==false,hasShips:item.hasShips!==false,isPackage:item.isPackage===true,contents:item.gameItems.map((i:Json)=>({code:i.code,name:i.name,kind:i.kind,hasGamePurchase:i.hasGamePurchase!==false}))});
  }
  if(skus.length===total)break;
  if(!rows.count||skus.length>total||page===30)throw Error('PAINT_CATALOGUE_INCOMPLETE');
 }
 if(total===null||skus.length!==total)throw Error('PAINT_CATALOGUE_INCOMPLETE');
 const rawRules=store(await read(PAINT_RULE_QUERY,{products:products.map(Number)},signal)).dynamicDiscounts;
 if(!Array.isArray(rawRules)||rawRules.length>100)throw Error('PAINT_RULES_INVALID');
 const rules=rawRules.map((r:Json)=>({id:r.id,from:r.from_cart_qty,to:r.to_cart_qty,percent:r.percent_off??0,amountOff:r.amount_off??null,maximum:r.max_value??null,products:r.targeted_products?.map(String),skus:r.targeted_skus?.map(String)}));
 return paintCatalogueSchema.parse({schemaVersion:1,source:'rsi-public-paints',fetchedAt:now(),currency:'USD',taxBasis:'net',skus,rules});
}
