import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {ExportContext} from '../export/model';
import type {PlannerInventory} from './ChainBuilder';
import {prepareChains,type ChainStep} from '../planner/chain';
import {chainVariants,manualChain} from '../planner/manual';
import {additionalCost,chainCosts,chainSavings,paidCcuCost,type CostTotal} from '../planner/costs';
import {purchasePriceReader} from '../planner/shopping-list';
import {anchorFromStep,type DraftAnchor,type PlannerDraft} from '../planner/draft';
import {previewPlacement,type Placement} from '../planner/placement';
import {ChainLink} from './ChainLink';
import {useChainSearch} from './useChainSearch';
import {withoutExcludedCcus} from '../planner/exclusions';
import {selectedStartBase,withStartBase,approveStartBase,startBaseChoices} from '../planner/bases';
import {pledgeDateLabel,comparePledgeDates} from '../domain/pledge-date';
import type {useCcuExclusions} from './useCcuExclusions';
import {CcuLock} from './CcuLock';
import {PlanningAdvisors,type AdvisorContext} from './PlanningAdvisors';
import type { FairOfferRequest } from './FairNewsPanel';
import {availableForTarget,blockingPlanResources,type ResourceClaim} from '../planner/reservations';
import {offersAreStale,type CatalogueShip,type MarketSnapshot} from '../market/model';
import {nominalValue,shipValuesStale} from '../market/ship-values';
import {searchShips} from '../market/search';
import type {PricingSnapshot} from '../pricing/model';import {estimateMinor,estimatePlanningMinor,formatMinor,euroRateIsStale} from '../pricing/money';
import {planningRateLabel} from './planning-rate-label';
import {useShopPrices} from './useShopPrices';
import type {DraftEditor} from './usePlannerDrafts';import {useText} from './i18n';import {vatLabel} from './vat-label';
import './chain.css';import './workbench.css';
type Drag={scope:string;signature:string;anchor:DraftAnchor;step:ChainStep;index?:number};
type DropTarget={token:string;index:number;replace:boolean};
export function ChainWorkbench({accountId,inventory,target,market,display,editor,onShopError,onExportContext,blockedResources=[],reservationsReady=true,exclusions,advisors,fairOffer}:{accountId:string|null;inventory:PlannerInventory|null;
  target?:CatalogueShip;market?:MarketSnapshot;display:PricingSnapshot;editor:DraftEditor;onShopError?:(message:string)=>void;onExportContext?:(context:ExportContext)=>void;blockedResources?:readonly ResourceClaim[];reservationsReady?:boolean;exclusions:ReturnType<typeof useCcuExclusions>;advisors?:AdvisorContext;fairOffer?:FairOfferRequest|null}){
  const t=useText(),rail=useRef<HTMLDivElement>(null),drag=useRef<Drag|null>(null),[query,setQuery]=useState(''),[detail,setDetail]=useState<string|null>(null),[notice,setNotice]=useState(''),[opening,setOpening]=useState(false);
  const [stockView,setStockView]=useState<'grid'|'band'>('grid'),[stockColumns,setStockColumns]=useState(5);
  const [includeHigher,setIncludeHigher]=useState(false);
  const [advisorTab,setAdvisorTab]=useState<'chain'|'conflicts'|'purchase'>('chain');
  const advisorPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fairOffer) return;
    setAdvisorTab('purchase');
    const frame = requestAnimationFrame(() => {
      advisorPanel.current?.focus({ preventScroll: true });
      advisorPanel.current?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [fairOffer]);
  const [dragVisual,setDragVisual]=useState<Drag|null>(null),[dropTarget,setDropTarget]=useState<DropTarget|null>(null),[snapped,setSnapped]=useState<string|null>(null),animation=useRef(0);
  const [comparison,setComparison]=useState<{signature:string;index:number}|null>(null),bestRequested=useRef<string|null>(null);
  const [working,setWorking]=useState<{signature:string;index:number;draft:PlannerDraft;history:PlannerDraft[]}|null>(null);
  const shopPending=useRef(false),epoch=useRef(0),scope=(accountId??'')+':'+(target?.id??'');
  useEffect(()=>{epoch.current++;endDrag();setSnapped(null);setDetail(null);setNotice('');setQuery('');},[scope]);
  useEffect(()=>{const stop=()=>endDrag();window.addEventListener('dragend',stop);window.addEventListener('blur',stop);return ()=>{epoch.current++;cancelAnimationFrame(animation.current);window.removeEventListener('dragend',stop);window.removeEventListener('blur',stop);};},[]);
  const ready=!!accountId&&inventory?.accountId===accountId,current=!!market&&!offersAreStale(market);
  const observation=ready?inventory?.observation:undefined;
  const currentValues=shipValuesStale(market?.values)?null:market?.values;
  const priceFor=useMemo(()=>purchasePriceReader(market?.offers?.items??[],currentValues,current,Date.now(),display.shopPrices),[market?.offers,currentValues,current,display.shopPrices]);
  const stockPool=useMemo(()=>prepareChains(ready?inventory!.pledges:[],market?.catalogue?.ships??[],market?.offers?.items??[],current,ready?inventory?.observation:undefined,market?.values),[ready,inventory,market?.catalogue,market?.offers,current,market?.values]);
  const excluded=new Set(exclusions.keys);
  const pool=useMemo(()=>withoutExcludedCcus(stockPool,exclusions.keys),[stockPool,exclusions.keys]);
  const chosenBase=selectedStartBase(pool,editor.value),planPool=useMemo(()=>withStartBase(pool,chosenBase?.key),[pool,chosenBase?.key]);
  useEffect(()=>setIncludeHigher(false),[scope]);
  const baseChoices=startBaseChoices(pool,display,includeHigher,chosenBase?.key);
  const searchPool=useMemo(()=>availableForTarget(planPool,blockedResources),[planPool,JSON.stringify(blockedResources)]);
  const variants = useMemo(() => target && chosenBase && reservationsReady
    ? chainVariants(searchPool, target, market?.offers?.items ?? [], current, chosenBase.key, display) : [],
    [searchPool, target, market?.offers, current, chosenBase?.key, reservationsReady, display]);
  const automatic=variants[0]??null,savedManual=editor.value.mode==='manual';
  const searchSignature=JSON.stringify([scope,ready,reservationsReady,searchPool,target?.id,current,market?.offers?.items,editor.value.baseKey,display.settings,display.rate,display.shopPrices]);
  const scan=useChainSearch(ready&&target&&reservationsReady&&chosenBase?{pool:searchPool,target,offers:market?.offers?.items??[],current,baseKey:chosenBase.key,display}:null,searchSignature);
  const compared=comparison?.signature===searchSignature?scan.result?.plans[comparison.index]?.plan:null,editing=editor.ready&&exclusions.ready&&!exclusions.saving&&!!chosenBase;
  const testDraft=compared&&working?.signature===searchSignature&&working.index===comparison?.index?working:null;
  const manual=!!testDraft||savedManual&&!compared;
  const ownPlan=useMemo(()=>!chosenBase?null:savedManual&&target?manualChain(planPool,target,market?.catalogue?.ships??[],market?.offers?.items??[],current,editor.value,blockedResources):automatic,[savedManual,target,planPool,market,editor.value,automatic,current,chosenBase?.key,JSON.stringify(blockedResources)]);
  const plan=testDraft&&target&&chosenBase?manualChain(planPool,target,market?.catalogue?.ships??[],market?.offers?.items??[],current,testDraft.draft,blockedResources):compared??ownPlan;
  const resourceConflicts=blockingPlanResources(plan ?? (chosenBase ? {base:chosenBase,steps:[]} : null),blockedResources);
  const reservationsByTarget = useMemo(() => {
    const groups = new Map<number, { name: string; slot: number; ccus: number }>();
    for (const claim of blockedResources) {
      const { targetId, name, slot } = claim.winner;
      const group = groups.get(targetId) ?? { name, slot, ccus: 0 };
      if (claim.kind === 'ccu') group.ccus++;
      groups.set(targetId, group);
    }
    return [...groups.values()].sort((a, b) => a.slot - b.slot);
  }, [blockedResources]);
  useEffect(()=>{if(scan.result&&bestRequested.current===searchSignature){bestRequested.current=null;if(scan.result.bestProven&&scan.result.plans.length)setComparison({signature:searchSignature,index:0});}},[scan.result,searchSignature]);
  const steps=editor.ready&&exclusions.ready?plan?.steps??[]:[],selected=steps.find(s=>s.key===detail);
  useShopPrices(steps);
  const used=new Set(steps.filter(s=>s.kind==='owned').map(s=>s.ccu!.key));
  const autoAnchors=(variant=automatic):DraftAnchor[]=>variant?.steps.filter(s=>s.kind==='owned').map(anchorFromStep)??[];
  function activeDraft():PlannerDraft{return testDraft?.draft??(compared?{...editor.value,mode:'manual',initialized:true,baseKey:compared.base.key,anchors:compared.steps.map(anchorFromStep)}:savedManual?editor.value:{...editor.value,mode:'manual',initialized:true,baseKey:automatic?.base.key??editor.value.baseKey,anchors:autoAnchors()});}
  const active=activeDraft(),signature=JSON.stringify([plan?.base?.key,steps.map(s=>[s.key,s.anchorIndex]),active]);
  let exportValue:ExportContext=null;
  if(accountId&&target&&plan?.base&&editing&&reservationsReady&&!editor.saving&&!editor.error){
    try{const anchors=steps.map(anchorFromStep);exportValue={accountId,chain:{targetId:target.id,draft:{...active,mode:'manual',initialized:true,baseKey:plan.base.key,anchors},preview:!!compared}};}catch{/* A hypothetical advisor quote is not a serializable owned-stock chain. */}
  }
  const exportSignature=JSON.stringify(exportValue);
  useEffect(()=>{onExportContext?.(JSON.parse(exportSignature) as ExportContext);},[exportSignature,onExportContext]);
  useEffect(()=>()=>onExportContext?.(null),[onExportContext]);
  const hasLockedAnchors=active.anchors.some(a=>a.kind==='owned'&&excluded.has(a.key)&&stockPool.ccus.some(c=>c.key===a.key));
  const ownedTiles:ChainStep[]=pool.limited?[]:stockPool.ccus.map(ccu=>({key:ccu.key,kind:'owned',from:ccu.from,to:ccu.to,ccu}));
  const gapTiles=[...new Map([...(automatic?.steps??[]),...steps].filter(s=>s.kind==='purchase'&&s.validity!=='invalid').map(s=>[s.from.key+'\0'+s.to.key,s])).values()];
  const tilePledges=new Map((ready?inventory!.pledges:[]).map(p=>[p.pledgeId,p]));
  const tiles=[...ownedTiles.sort((a,b)=>comparePledgeDates(tilePledges.get(a.ccu?.pledgeId??''),tilePledges.get(b.ccu?.pledgeId??''))),...gapTiles];
  const matches=query.trim()?new Set(searchShips(tiles.map((s,i)=>({id:i+1,name:s.from.name+' '+s.to.name,chassisId:null,manufacturer:'',manufacturerCode:'',status:'unknown',focus:'',length:null})),query).map(s=>s.id)):null;
  const shownTiles=tiles.map((step,index)=>({step,index})).filter(({index})=>!matches||matches.has(index+1));
  const indexedSteps=steps.map((step,index)=>({...step,boardIndex:compared&&!testDraft?index:manual?step.anchorIndex:step.kind==='owned'?steps.slice(0,index).filter(s=>s.kind==='owned').length:undefined}));
  const at=(index:number)=>indexedSteps.slice(index).find(s=>s.boardIndex!==undefined)?.boardIndex??active.anchors.length;
  function endDrag(){drag.current=null;setDragVisual(null);setDropTarget(null);cancelAnimationFrame(animation.current);}
  function commit(draft:PlannerDraft){if(!editor.ready||pool.limited)return;endDrag();bestRequested.current=null;setNotice('');setDetail(null);
    if(compared){setWorking({signature:searchSignature,index:comparison!.index,draft,history:[...(testDraft?.history??[]),active].slice(-20)});return;}editor.change(draft);}
  function chooseComparison(index:number|null){endDrag();setWorking(null);setComparison(index===null?null:{signature:searchSignature,index});setNotice('');setDetail(null);}
  function undo(){endDrag();if(testDraft?.history.length){const history=[...testDraft.history],draft=history.pop()!;setWorking({...testDraft,draft,history});}else if(!compared)editor.undo();}
  function start(event:React.DragEvent,step:ChainStep,index?:number){if(!editing||excluded.has(step.key)||step.kind==='missing'||step.kind==='conflict'){event.preventDefault();return;}
    drag.current={scope,signature,anchor:index!==undefined?active.anchors[index]??anchorFromStep(step):anchorFromStep(step),step,...(index!==undefined?{index}:{})};setDragVisual(drag.current);setSnapped(null);setNotice('');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain','Sarevoc CCU');}
  function place(anchor:DraftAnchor,index:number,replace=false,sourceIndex?:number){
    if(anchor.kind==='owned'&&excluded.has(anchor.key)){setNotice('Dieses CCU-Exemplar ist für die Planung gesperrt.');return;}
    const next=[...active.anchors];let to=index;
    if(sourceIndex!==undefined){next.splice(sourceIndex,1);if(sourceIndex<to)to--;replace=false;}
    if(anchor.kind==='owned'&&next.some(a=>a.kind==='owned'&&a.key===anchor.key)){setNotice('Dieses CCU-Exemplar ist bereits eingeplant.');return;}
    if(replace)next.splice(to,1,anchor);else next.splice(to,0,anchor);
    commit({...active,anchors:next});
  }
  function candidate(index:number,replace=false):Placement{
    const source=drag.current;if(!source||!target||!editor.ready||source.scope!==scope||source.signature!==signature)return {status:'blocked',reason:'changed'};
    return previewPlacement(pool,target,market?.catalogue?.ships??[],market?.offers?.items??[],current,active,source.anchor,index,replace,source.index);
  }
  function fitLabel(p:Placement){return t(p.status==='blocked'?p.reason==='duplicate'?'Dieses CCU-Exemplar ist bereits eingeplant.':p.reason==='changed'?'Bestand oder Entwurf hat sich geändert. Bitte erneut ziehen.':'Passt hier nicht':p.status==='direct'?'Beide Anschlüsse passen':p.status==='gap'?'Passt mit Restlücke':'Anschluss ungeprüft');}
  function drop(event:React.DragEvent,index:number,replace=false){if(!drag.current)return;event.preventDefault();const result=candidate(index,replace),key=drag.current.step.key;endDrag();
    if(!result.draft){setNotice(fitLabel(result));return;}commit(result.draft);setSnapped(key);setNotice(t(result.status==='direct'?'CCU eingerastet.':result.status==='gap'?'CCU eingefügt. Restlücken bleiben sichtbar.':'CCU eingefügt. Anschluss bleibt ungeprüft.'));
  }
  function followOpening(element:HTMLElement){cancelAnimationFrame(animation.current);let before=element.getBoundingClientRect().width;const until=performance.now()+250;
    const frame=()=>{if(!element.isConnected||!rail.current)return;const width=element.getBoundingClientRect().width;rail.current.scrollLeft+=(width-before)/2;before=width;if(performance.now()<until)animation.current=requestAnimationFrame(frame);};animation.current=requestAnimationFrame(frame);
  }
  function over(event:React.DragEvent,index:number,replace:boolean,token:string){if(drag.current?.scope!==scope)return;event.preventDefault();const fit=candidate(index,replace);event.dataTransfer.dropEffect=fit.status==='blocked'?'none':'move';
    if(dropTarget?.token!==token){if(!replace)followOpening(event.currentTarget as HTMLElement);setDropTarget({token,index,replace});}}
  function leave(event:React.DragEvent,token:string){if(dropTarget?.token!==token)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom)return;
    if(!dropTarget.replace)followOpening(event.currentTarget as HTMLElement);setDropTarget(null);
  }
  async function openShop(){if(shopPending.current)return;const generation=epoch.current;shopPending.current=true;setOpening(true);
    try{const r=await window.ccu.request({action:'market.openUpgrades'});if(!r.ok)throw Error('OPEN');}catch{if(epoch.current===generation)onShopError?.('RSI-Upgrade-Seite konnte nicht geöffnet werden.');}
    finally{shopPending.current=false;setOpening(false);}}
  function remove(index:number){commit({...active,anchors:active.anchors.filter((_,i)=>i!==index)});}
  const variantSignature=(list:readonly ChainStep[])=>JSON.stringify(list.map(s=>[s.kind,s.from.key,s.to.key]));
  const variantIndex=plan?variants.findIndex(v=>variantSignature(v.steps)===variantSignature(steps)):-1;
  const pledges=ready?inventory!.pledges:[],rawCosts=editor.ready&&ready&&plan?chainCosts(plan,pledges,display,current,priceFor,observation):null;
  const paidFor=(step:ChainStep)=>paidCcuCost(step,pledges,display,observation);
  function dateBadge(pledgeId?:string){const p=pledges.find(p=>p.pledgeId===pledgeId);if(!p)return null;const date=pledgeDateLabel(p,display.settings.language,true);return date?<span title={t('Erhalten am (RSI)')+': '+pledgeDateLabel(p,display.settings.language)+' · '+t('Kein Beleg des persönlichen Kaufdatums.')}> · {date}</span>:null;}
  const costs=rawCosts&&(resourceConflicts.length||!reservationsReady)?{...rawCosts,invalid:true,investment:null}:rawCosts;
  const money=(minor:number|null,approximate=false)=>minor===null?t('Preis offen'):(approximate?'≈ ':'')+formatMinor(minor,display.settings.currency,display.settings.language);
  const total=(value:CostTotal,paid=false)=>value.missing?(value.knownMinor?money(value.knownMinor,value.approximate)+' + '+value.missing+' '+t(value.missing===1?'Preis offen':'Preise offen'):t(paid?'noch nicht erfasst':'Preis offen')+' ('+value.missing+')'):money(value.knownMinor,value.approximate);
  const additional=!reservationsReady?t('Planungsdaten prüfen'):hasLockedAnchors?t('Gesperrtes CCU'):resourceConflicts.length?t('Ressourcenkonflikt'):costs?(costs.invalid?t('Anschluss prüfen'):total(costs.additional)):t('noch offen');
  const pricedTotal=costs&&!costs.invalid&&reservationsReady&&!hasLockedAnchors&&!resourceConflicts.length?costs.additional:null;
  const investment=pricedTotal?costs?.investment??null:null;
  const investmentEstimate=!!costs&&(costs.paid.approximate||costs.additional.approximate);
  const standardUsd=target?nominalValue(target,market?.offers?.items??[],current,currentValues):null;
  const savings=chainSavings(investment,standardUsd,display);
  const partialTotal=!!pricedTotal?.missing;
  const amountLabel=partialTotal&&pricedTotal.knownMinor?t('Bekannte Teilsumme'):t('Summe');
  const amountText=partialTotal?(pricedTotal.knownMinor?money(pricedTotal.knownMinor,pricedTotal.approximate):t('offen')):additional;
  const costDetailId=React.useId();
  const costToggle=useRef<HTMLButtonElement>(null);
  const invalid=manual&&plan&&'invalid'in plan&&plan.invalid;
  function priceInfo(step:ChainStep){const value=additionalCost(step,display,current,priceFor),paid=paidFor(step);
    const hint=step.kind==='purchase'?t(priceFor(step).kind==='warbond'?'Warbond-Einstieg · ungeprüft':'Richtwert aus Schiffswertdifferenz'):undefined;
    const priceLabel = step.kind !== 'purchase' ? 'Noch zu zahlen' : value.minor === null ? 'Preis offen'
      : !value.approximate ? 'RSI-Shoppreis' : display.settings.currency === 'EUR' ? 'EZB-Richtwert' : 'Zukauf · Richtwert';
    return <span className="ccu-step-price" title={value.approximate?hint:undefined}><span>{t(priceLabel)}</span><strong>{money(value.minor,value.approximate)}</strong>
      {step.kind==='owned'?<small>{t(paid.rsiOrder?'RSI-Bestellpreis':'Kaufpreis')}: {paid.minor===null?t('noch nicht erfasst'):money(paid.minor,paid.approximate)}</small>
        :<small>{t(value.minor===null?'Preis / Kaufbarkeit offen':'Kaufbarkeit ungeprüft')}</small>}
      {step.kind==='purchase'&&display.settings.currency==='EUR'&&value.usdMinor!==null&&<small>{formatMinor(estimateMinor(value.usdMinor,{...display.settings,currency:'USD'},null)!,'USD',display.settings.language)} · {display.settings.taxMode==='gross'?vatLabel(display.settings.vatBasisPoints,display.settings.language):t('vor Steuer')}</small>}</span>;
  }
  function connector(broken=false){return <ChainLink broken={broken} label={t(broken?'Offene Verbindung nach rechts':'Verbindung nach rechts')}/>;}
  function insertionSlot(index:number,token:string,label:string,edge=false){const open=dropTarget?.token===token&&!!dragVisual,fit=open?candidate(index):null;
    return <div className={'ccu-drop-slot'+(edge?' edge':'')+(open?' open '+fit!.status:'')} aria-label={label} data-fit={fit?.status}
      onDragEnter={event=>over(event,index,false,token)} onDragOver={event=>over(event,index,false,token)} onDragLeave={event=>leave(event,token)} onDrop={event=>drop(event,index)}>
      {open?<><span className="ccu-snap-link">{connector(fit!.status!=='direct')}</span><div className={'ccu-snap-ghost '+dragVisual!.step.kind}><span className="ccu-ownership">{t(dragVisual!.step.kind==='owned'?'Im Bestand':'Noch kaufen')}</span><strong>{dragVisual!.step.from.name} → {dragVisual!.step.to.name}</strong><small role="status">{fitLabel(fit!)}</small></div><span className="ccu-snap-link">{connector(fit!.status!=='direct')}</span></>:edge?'+':connector()}
    </div>;
  }
  function stepCard(step:typeof indexedSteps[number],index:number){
    const missing=step.kind==='missing',purchase=step.kind==='purchase',physicalKey=step.ccu?.key??step.referenceKey;
    const held=physicalKey?stockPool.ccus.find(c=>c.key===physicalKey):undefined,locked=!!held&&excluded.has(held.key);
    const token='card:'+step.key,highlight=dropTarget?.token===token?candidate(step.boardIndex??at(index),step.boardIndex!==undefined).status:null;
    const lockedCost=locked?paidFor({...step,kind:'owned',ccu:held}):null;
    return <article key={step.key+':'+index} className={'ccu-step '+(locked?'owned is-locked':step.kind)+(step.validity==='invalid'&&!locked?' invalid':'')+(snapped===step.key?' snapped':'')+(highlight?' drop-'+highlight:'')} draggable={editing&&!missing&&!locked}
      data-resource-key={physicalKey} data-anchor-index={step.boardIndex} data-step-index={index} data-drop-fit={highlight} onDragStart={event=>start(event,step,step.boardIndex)} onDragEnd={endDrag}
      onDragOver={event=>over(event,step.boardIndex??at(index),step.boardIndex!==undefined,token)} onDragLeave={event=>leave(event,token)} onDrop={event=>drop(event,step.boardIndex??at(index),step.boardIndex!==undefined)}>
      <div className="ccu-kind"><span>{t(locked?(held?.warbond?'Warbond-CCU':'CCU'):missing?'Nicht mehr im Bestand':purchase?(priceFor(step).kind==='warbond'?'Warbond-CCU':'Standard-CCU'):step.ccu?.warbond?'Warbond-CCU':'CCU')}</span>
        {purchase?<button className="ccu-ownership" disabled={opening} aria-label={t('RSI-Upgrades öffnen')+': '+step.from.name+' → '+step.to.name} onClick={()=>void openShop()}>{t('Noch kaufen')}</button>:<span className="ccu-ownership">{t(locked?'Gesperrt':missing?'Prüfen':'Im Bestand')}{dateBadge((held??step.ccu)?.pledgeId)}</span>}</div>
      <button className="ccu-step-details" aria-label={t('CCU-Details')+': '+step.from.name+' → '+step.to.name} aria-expanded={detail===step.key} onClick={()=>setDetail(detail===step.key?null:step.key)}>
        <span className="ccu-route"><span className="ccu-model"><small>{t('Von')}</small><strong>{step.from.name}</strong></span><span className="ccu-model"><small>{t('Nach')}</small><strong>{step.to.name}</strong></span></span>
        {lockedCost?<span className="ccu-step-price"><span>{t('Bereits bezahlt')}</span><strong>{money(lockedCost.minor,lockedCost.approximate)}</strong><small>{t('Von Berechnungen ausgeschlossen')}</small></span>:<>{missing&&<span className="ccu-paid">{t('Exemplar fehlt')}</span>}{priceInfo(step)}</>}</button>
      {(step.boardIndex!==undefined||held)&&<div className="ccu-edit-buttons">
        {held&&<CcuLock locked={locked} disabled={!exclusions.ready||exclusions.saving} label={step.from.name+' → '+step.to.name} onToggle={()=>exclusions.toggle(held.key)}/>}
        {step.boardIndex!==undefined&&<><button aria-label={t('Schritt nach links')} disabled={!editing||locked||step.boardIndex===0} onClick={()=>place(active.anchors[step.boardIndex!]!,step.boardIndex!-1,false,step.boardIndex)}>←</button>
        <button aria-label={t('Schritt nach rechts')} disabled={!editing||locked||step.boardIndex>=active.anchors.length-1} onClick={()=>place(active.anchors[step.boardIndex!]!,step.boardIndex!+2,false,step.boardIndex)}>→</button>
        <button aria-label={t('Schritt entfernen')} disabled={!editing} onClick={()=>remove(step.boardIndex!)}>×</button></>}
      </div>}
    </article>;
  }
  function inspectVariants(best=false){if(!reservationsReady)return;endDrag();setWorking(null);if(best&&scan.result?.bestProven&&scan.result.plans.length){chooseComparison(0);return;}bestRequested.current=best?searchSignature:null;setComparison(null);scan.run();}
  function applyComparison(){if(!compared||!scan.result?.bestProven||active.anchors.length>100)return;endDrag();editor.change(active);setWorking(null);setComparison(null);setNotice('');}
  const shownVariants=scan.result?scan.result.plans.map(p=>p.plan):variants;
  const selectedVariant=scan.result?(compared?String(comparison!.index):'own'):variantIndex<0?'own':String(variantIndex);
  function priceRow(value:NonNullable<typeof plan>,label:string,index?:number){const c=chainCosts(value,pledges,display,current,priceFor,observation),conflicted=blockingPlanResources(value,blockedResources).length>0;return <tr key={index??label} className={testDraft?label===t('Testentwurf')?'selected':'':compared&&index===comparison?.index?'selected':''}>
    <th scope="row">{index===undefined?label:<button aria-label={t('Variante ansehen')+' '+(index+1)} onClick={()=>chooseComparison(index)}>{label}</button>}<small>{value.base?.model.name??t('Basis ungeprüft')} · {value.ownedCount} {t('Bestand')} · {value.gapCount} {t('Lücken')}</small></th>
    <td>{total(c.paid,true)}</td><td>{conflicted?t('Ressourcenkonflikt'):c.invalid?t('Anschluss prüfen'):total(c.additional)}{scan.result?.fallbackUsd&&index!==undefined&&<small>≈ {formatMinor(scan.result.plans[index]!.score[0],'USD',display.settings.language)} · {t('Vergleich vor Steuer')}</small>}</td>
    <td>{conflicted?t('Ressourcenkonflikt'):money(c.investment,c.paid.approximate||c.additional.approximate)}</td><td>{t(c.paid.missing?'Kaufpreise unvollständig':c.additional.approximate?'Altpreise belegt':'Kaufpreise belegt')}{(c.additional.approximate||c.additional.missing>0)&&<small>{t('Zukauf ungeprüft')}</small>}{c.paid.approximate&&<small>{t('Altpreise als Richtwert')}</small>}</td></tr>;}
  return <section className={'panel market-chain ccu-builder ccu-workbench'+(dragVisual?' is-dragging':'')} aria-label={t('Kettenbauer')}>
    <div className="ccu-builder-head"><h2>{t('CCU-Kette')}{target?' → '+target.name:''}</h2>
      <div className="ccu-price-cards">
        <div className="ccu-total ccu-savings" title={t('Vergleich mit dem aktuellen Standard-Schiffswert. Kosten der Basis, gekaufter CCUs und geplanter Zukäufe zählen zusammen.')+' '+t('In der Bruttoansicht zählen belegte RSI-Bestellpreise in ihrer ursprünglichen Höhe. Historischer Steueranteil und Zahlungsmittel sind darin nicht aufgeschlüsselt.')}>
          <span>{t(savings!==null&&savings<0?'Mehrkosten der CCU-Kette':'Gespart durch CCU-Kette')}</span>
          <strong aria-live="polite" aria-atomic="true">{money(savings===null?null:Math.abs(savings),true)}</strong>
          <small>{t('Schiff kostet dich')} {money(investment,investmentEstimate)}</small>
        </div>
      <button className="ccu-total" type="button" ref={costToggle} aria-expanded={detail==='cost'} aria-controls={costDetailId}
        onClick={()=>setDetail(detail==='cost'?null:'cost')}>
        <span>{t('Noch zu zahlen')}</span>
        <strong aria-live="polite" aria-atomic="true">{pricedTotal?amountLabel+' ':''}{amountText}</strong>
        {partialTotal&&<small>{pricedTotal.missing} {t(pricedTotal.missing===1?'Preis offen':'Preise offen')}</small>}
      </button>
      </div>
    </div>
    <div id={costDetailId} hidden={detail!=='cost'} className={detail==='cost'?'ccu-detail ccu-total-detail':undefined}>
      {detail==='cost'&&<><div><strong>{t('Zusätzliche Ausgaben')}: {additional}</strong>
        <p>{t('Zukauf vor dem Einsatz von Store Credits. Der Flottenplan zeigt Frischgeld und Guthaben getrennt.')}</p>
        <p>{t(plan?.gapCount?'Die orangefarbenen Lücken brauchen noch bestätigte CCU-Kaufpreise. Zielschiffpreise sind keine CCU-Preise.':'Vorhandene CCUs werden nicht erneut berechnet. Es wird nichts gekauft oder angewendet.')}</p>
        <p>{t('Für Standard-CCUs zählt die Schiffswertdifferenz. Bei passendem Warbond-Angebot zählt der beobachtete Einstiegspreis.')}
          {' '}{display.settings.taxMode==='gross'?vatLabel(display.settings.vatBasisPoints,display.settings.language):t('vor Steuer')}
          {display.settings.currency==='EUR'&&<> · {planningRateLabel(display)}</>}</p></div>
        <button aria-label={t('CCU-Details schließen')} onClick={()=>{setDetail(null);costToggle.current?.focus();}}>×</button></>}
    </div>
    {advisors&&<div className="advisor-tabs" role="tablist" aria-label={t('Planungsbereich')}>{([['chain','Kette bauen'],['conflicts','Konflikte lösen'],['purchase','CCU-Kaufoptimierer']] as const).map(([key,label])=><button key={key} role="tab" aria-selected={advisorTab===key} onClick={()=>{endDrag();setAdvisorTab(key);}}>{t(label)}{key==='conflicts'&&advisors.conflicts>0&&<span className="advisor-count">{advisors.conflicts}</span>}</button>)}</div>}
    <div>
    <div className="ccu-start-base"><label><strong>{t('LTI-Startbasis selbst wählen')}</strong><small>{t('Günstige Tokens zuerst. Keine automatische Vorauswahl.')}</small></label><select aria-label={t('Startbasis für die Kette')} disabled={!editor.ready||exclusions.saving||!target||!ready} value={chosenBase?.key??''} onChange={event=>{const base=pool.bases.find(b=>b.key===event.target.value);if(!base)return;chooseComparison(null);editor.change(approveStartBase(pool,editor.value,base.key));}}>
      <option value="" disabled>{t('Bitte LTI-Startbasis auswählen …')}</option>{baseChoices.map(b=><option key={b.key} value={b.key}>{b.model.name} · LTI · {money(b.model.nominalUsd===null?null:estimatePlanningMinor(b.model.nominalUsd,{...display.settings,taxMode:'net'},display.rate&&!euroRateIsStale(display.rate)?display.rate:null),true)} · {b.pledgeName}</option>)}</select>
      <label className="ccu-higher"><input type="checkbox" checked={includeHigher} onChange={e=>setIncludeHigher(e.target.checked)}/>{t('Auch höherwertige eigene LTI-Schiffe zur Auswahl anbieten')}</label>
      <small>{t('Bis etwa 50 € Richtwert vor Steuer zuerst. Höhere oder unbekannte Werte nur bewusst auswählen.')}</small>
      {!chosenBase&&<div className="ccu-base-required" role="status"><strong>{t(editor.ready?'Wähle zuerst deine Startbasis':'Entwurf wird geladen …')}</strong><p>{t('Vorher werden weder Varianten noch Kaufempfehlungen berechnet.')}</p>{editor.value.baseKey&&<p>{t('Alte Entwürfe bleiben gespeichert; ihre bisherige Basis muss einmal bewusst bestätigt werden.')}</p>}</div>}
    </div>
    <div hidden={!chosenBase}>
    <div className="ccu-builder-tools"><div className="ccu-views" role="group" aria-label={t('Kettenansicht')}>
      <button disabled={!editor.ready} aria-pressed={!savedManual&&!compared} onClick={()=>{chooseComparison(null);editor.change({...editor.value,mode:'auto'});}}>{t('Vorschlag')}</button>
      <button disabled={!editor.ready} aria-pressed={manual} onClick={()=>commit(compared?active:editor.value.initialized?{...editor.value,mode:'manual'}:active)}>{t('Selbst bauen')}</button></div>
      <div className="ccu-search-actions"><button disabled={!editor.ready||!ready||!target||!reservationsReady||pool.limited||scan.pending} onClick={()=>inspectVariants()}>{t('Varianten prüfen')}</button><button aria-pressed={!!compared&&!testDraft&&comparison?.index===0} disabled={!editor.ready||!ready||!target||!reservationsReady||pool.limited||scan.pending} onClick={()=>inspectVariants(true)}>{t('Bester bekannter Weg')}</button></div>
      <label className="ccu-variant">{t('Variante')}<select aria-label={t('Kettenvariante')} disabled={!editor.ready||!shownVariants.length} value={selectedVariant} onChange={event=>{
        if(scan.result){chooseComparison(event.target.value==='own'?null:Number(event.target.value));return;}const v=variants[Number(event.target.value)];if(v)commit({...editor.value,mode:'manual',initialized:true,baseKey:v.base.key,anchors:autoAnchors(v)});
      }}><option value="own" disabled={!scan.result}>{t('Eigener Entwurf')}</option>{shownVariants.map((v,i)=>{const different=v.steps.find(s=>s.kind==='owned'&&!automatic?.steps.some(a=>a.kind==='owned'&&a.from.key===s.from.key&&a.to.key===s.to.key));
        return <option key={i} value={i}>{i+1}: {scan.result?total(chainCosts(v,pledges,display,current,priceFor).additional)+' · '+v.ownedCount+' '+t('Bestand')+' · '+v.gapCount+' '+t('Lücken'):different?t('über')+' '+different.to.name:v.ownedCount+' '+t('Bestand')+' · '+v.gapCount+' '+t('Lücken')}</option>;})}</select></label>
    </div>
    {exclusions.error&&<p className="ccu-priority-warning" role="alert">{t(exclusions.error)}</p>}
    {!reservationsReady&&target&&<p className="ccu-priority-warning" role="status">{t('Planungsdaten prüfen')}</p>}
    {reservationsReady && target && reservationsByTarget.length > 0 &&
      <div className={'ccu-priority-warning' + (resourceConflicts.length ? '' : ' ccu-priority-info')} role="status">
        {resourceConflicts.length > 0 && <strong>{t('Ressourcenkonflikt')}</strong>}
        <div className="ccu-priority-owners">{reservationsByTarget.map(({ name, slot, ccus }) =>
          <strong key={slot}>{ccus ? ccus + ' ' + t(ccus === 1 ? 'CCU' : 'CCUs') : t('Startbasis')}{' '}
            {t('für {name} eingeplant').replace('{name}', () => name)} · {t('Ziel')} {slot + 1}</strong>
        )}</div>
        <span>{t('Der Vorschlag für {name} nutzt die übrigen CCU-Exemplare.').replace('{name}', () => target.name)}</span>
        {resourceConflicts.length > 0 && <ul>{resourceConflicts.map(claim => <li key={claim.kind + ':' + claim.key}>
          {t(claim.kind === 'base' ? 'Basis' : 'CCU')}: {claim.label} — {t('Vorrang')}: {claim.winner.name}
        </li>)}</ul>}
        {scan.result && !scan.result.plans.length &&
          <small>{t('Keine vollständig berechenbare Kette mit den übrigen Exemplaren.')}</small>}
      </div>}
    {(scan.pending||scan.result||scan.error)&&<div className="ccu-comparison" aria-label={t('Preisvergleich')} aria-busy={scan.pending}>
      <div className="ccu-comparison-head"><div role="status">{scan.pending?t('Varianten werden geprüft …'):scan.error?t('Variantenprüfung fehlgeschlagen. Eigener Entwurf bleibt erhalten.'):testDraft?t('Freier Testentwurf · eigener Entwurf bleibt erhalten'):compared?t('Vorschau · eigener Entwurf bleibt erhalten'):t('Preisvergleich · eigener Entwurf bleibt erhalten')}
        {scan.result&&<small>{scan.result.plans.length} {t('Wege angezeigt')} · {scan.result.basesChecked} {t(scan.result.bestProven?'Basen geprüft':'Basen im Suchraum')} · {scan.result.ccusChecked} {t('CCUs geprüft')} · {t('Reihenfolge: geringster Zukauf')}</small>}</div>
        {compared&&<button disabled={!editor.ready||!scan.result?.bestProven} onClick={applyComparison}>{t('Übernehmen')}</button>}</div>
    </div>}
    <div className="ccu-rail" ref={rail} aria-label={t('CCUs in Reihenfolge')}>{indexedSteps.map((step,index)=><React.Fragment key={step.key+':'+index}>
      {step.kind==='conflict'?<div className="ccu-connection-conflict" role="status" onDragOver={event=>over(event,at(index),false,'conflict:'+step.key)} onDragLeave={event=>leave(event,'conflict:'+step.key)} onDrop={event=>drop(event,at(index))}>{connector(true)}<strong>{t('Kein Vorwärtsanschluss')}</strong><span>{step.from.name} → {step.to.name}</span>{step.boardIndex!==undefined&&<button aria-label={t('Schritt entfernen')} onClick={()=>remove(step.boardIndex!)}>×</button>}</div>
        :<>{insertionSlot(at(index),'slot:'+step.key,t('Hier einfügen')+' '+(index+1),index===0)}{stepCard(step,index)}</>}</React.Fragment>)}
      {!!target&&editing&&insertionSlot(active.anchors.length,'last',t('Am Ende einfügen'),true)}
      {!steps.length&&<p className="ccu-empty">{t(pool.limited?'Bestand für Kettenplanung zu groß.':!target?'Wähle oben dein Zielschiff.':!editor.ready?'Entwurf wird geladen …':!ready?'Bestand wird geladen …':!pool.bases.length?'Keine mögliche Startbasis erkannt.':plan?.base?.model.key==='matrix:'+target.id?'Das Zielschiff ist bereits als Basis vorhanden.':!manual&&reservationsReady?'Kein Vorschlag mit vollständig berechenbaren Preisen.':'Ziehe ein CCU in die Kette.')}</p>}</div>
    {costs&&<div className="ccu-cost-summary"><span>{t('Bereits bezahlt (Basis und CCUs)')}: <strong>{total(costs.paid,true)}</strong></span><span>{t('Gesamte Investition')}: <strong>{money(costs.investment,costs.additional.approximate||costs.paid.approximate)}</strong></span></div>}
    <div className="ccu-builder-foot"><span>{t('Vorschau · keine Reservierung')}{plan?' · '+plan.ownedCount+' '+t('Bestand')+' · '+plan.gapCount+' '+t('Lücken'):''} · {t(compared?'Testentwurf – noch nicht übernommen':editor.saving?'Wird gespeichert …':editor.error?'Nicht gespeichert':'Lokal gespeichert')}</span>
      <div className="ccu-workbench-actions"><button disabled={compared?!testDraft?.history.length:!editor.canUndo} onClick={undo}>↶ {t('Rückgängig')}</button><button disabled={!editing||!automatic} onClick={()=>compared?setWorking(null):commit({...editor.value,mode:'manual',initialized:true,baseKey:automatic!.base.key,anchors:autoAnchors()})}>{t('Vorschlag wiederherstellen')}</button></div></div>
    {(notice||editor.error||invalid)&&<p className={'ccu-workbench-message '+(invalid||editor.error?'error':'')} role="status">{t(notice||editor.error||(hasLockedAnchors?'Der Entwurf enthält ein gesperrtes CCU. Freigeben oder eine Alternative wählen.':pool.limited?'Bestand für Kettenplanung zu groß.':plan&&'issues'in plan&&plan.issues.includes('missing-base')?'Startbasis fehlt. Bitte Basis wählen.':plan&&'issues'in plan&&plan.issues.includes('missing-ccu')?'Ein eingeplantes CCU fehlt im aktuellen Bestand.':'Die Reihenfolge passt an der rot markierten Verbindung nicht.'))}</p>}
    {scan.result&&<details className="ccu-price-details" aria-label={t('Preisvergleich')}><summary>{t('Preisvergleich')} · {scan.result.plans.length} {t('Wege angezeigt')}</summary>
      {scan.result&&<><p className="ccu-search-evidence">{t('Verglichen werden vollständig bepreiste Wege zwischen Startbasis, Bestandsmodellen und Ziel. Standard-CCUs und passende Warbond-Angebote liefern die Richtwerte.')}
        {!!scan.result.unknownModels&&<> {scan.result.unknownModels} {t('Modelle ohne Preis; kein vollständiger Preisvergleich.')}</>}{scan.result.fallbackUsd&&<> {t('Wechselkurs fehlt: Reihenfolge in USD vor Steuer.')}</>}
        {!scan.result.alternativesComplete&&<> {t('Prüfgrenze erreicht; Alternativen nicht vollständig.')}</>}{!scan.result.bestProven&&<> {t('Kein bester Weg bestätigt.')}</>}{!scan.result.plans.length&&<> {t('Kein vergleichbarer Weg mit belegbaren Modellwerten.')}</>}</p>
        {!!scan.result.plans.length&&<table className="ccu-price-comparison"><thead><tr><th>{t('Variante')}</th><th>{t('Bereits bezahlt')}</th><th>{t('Noch zu kaufen')}</th><th>{t('Gesamtkosten')}</th><th>{t('Preisbeleg')}</th></tr></thead><tbody>{ownPlan&&priceRow(ownPlan,t('Eigener Entwurf'))}{testDraft&&plan&&priceRow(plan,t('Testentwurf'))}{scan.result.plans.map((p,i)=>priceRow(p.plan,String(i+1),i))}</tbody></table>}
        {compared&&costs&&<p className="ccu-price-equation">{resourceConflicts.length?t('Ressourcenkonflikt'):costs.paid.missing||costs.additional.missing?<>{t('Gesamtkosten')}: {t('Preis offen')} · {t('Fehlende Preisbelege')}: {costs.paid.missing+costs.additional.missing}</>:<>{total(costs.paid,true)} {t('bereits bezahlt')} + {total(costs.additional)} {t('Zukauf')} = {money(costs.investment,costs.paid.approximate||costs.additional.approximate)} {t('Gesamtkosten')}</>}</p>}</>}
    </details>}
    <div className="ccu-stock" hidden={advisorTab!=='chain'}><div className="ccu-stock-head"><strong>{t('Dein CCU-Vorrat')} ({stockPool.ccus.length}) · {t('Fehlende Verbindungen')} ({gapTiles.length})</strong>
      <div className="ccu-stock-tools" role="group" aria-label={t('Vorratsansicht')}><button aria-pressed={stockView==='band'} onClick={()=>setStockView('band')}>{t('Kartenband')}</button><button aria-pressed={stockView==='grid'} onClick={()=>setStockView('grid')}>{t('Raster')}</button><label>{t('Spalten')}<select aria-label={t('Spalten im Vorratsraster')} disabled={stockView!=='grid'} value={stockColumns} onChange={event=>setStockColumns(Number(event.target.value))}>{[3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></label></div>
      <small>{t('Ziehen oder mit + einfügen')}</small><input aria-label={t('CCU suchen')} placeholder={t('CCU suchen …')} value={query} maxLength={160} onChange={event=>setQuery(event.target.value)}/></div>
      <div className={'ccu-stock-row'+(stockView==='grid'?' ccu-stock-grid':'')} data-columns={stockColumns}>{shownTiles.map(({step,index})=>{const locked=step.kind==='owned'&&excluded.has(step.key),assigned=step.kind==='owned'&&used.has(step.key),reserved=step.kind==='owned'?blockedResources.find(r=>r.kind==='ccu'&&r.key===step.key):undefined;
        const cost=step.kind==='owned'?paidFor(step):additionalCost(step,display,current,priceFor);return <article key={step.key+':'+index} className={'ccu-stock-tile '+step.kind+(assigned?' assigned':'')+(locked?' is-locked':'')}
        data-resource-key={step.kind==='owned'?step.key:undefined} draggable={editing&&!assigned&&!locked} onDragStart={event=>start(event,step)} onDragEnd={endDrag}>
        <span className="ccu-ownership">{t(locked?'Gesperrt':assigned?'Bereits eingeplant':step.kind==='owned'?'Im Bestand':'Fehlende Verbindung')}{step.kind==='owned'&&dateBadge(step.ccu?.pledgeId)}</span><span className="ccu-route"><span className="ccu-model"><small>{t('Von')}</small><strong>{step.from.name}</strong></span><span className="ccu-model"><small>{t('Nach')}</small><strong>{step.to.name}</strong></span></span>
        {reserved&&<small className="ccu-reserved">{t('Vorrang')}: {reserved.winner.name}</small>}{step.kind==='owned'&&<CcuLock locked={locked} disabled={!exclusions.ready||exclusions.saving} label={step.from.name+' → '+step.to.name} onToggle={()=>exclusions.toggle(step.key)}/>}<small>{t(step.kind==='owned'?(cost.rsiOrder?'RSI-Bestellpreis':'Bereits bezahlt'):'Preisvorschau')}: {money(cost.minor,step.kind!=='owned'||cost.approximate)}</small><button aria-label={t('CCU einfügen')+': '+step.from.name+' → '+step.to.name} disabled={!editing||assigned||locked} onClick={()=>place(anchorFromStep(step),active.anchors.length)}>+</button></article>;})}
      {!shownTiles.length&&<span>{t(query?'Keine passenden Treffer':'Noch keine CCUs verfügbar.')}</span>}</div>
    </div>
    {selected&&<div className="ccu-detail"><div><strong>{selected.from.name} → {selected.to.name}</strong><p>{t(selected.kind==='owned'?'Unbenutztes CCU-Exemplar; Anwendbarkeit und Modellzuordnung müssen noch geprüft werden.':selected.kind==='missing'?'Das gespeicherte Exemplar ist im aktuellen Bestand nicht verfügbar.':'Vorgeschlagener Lückenfüller. Preis und Kaufbarkeit im RSI-Shop prüfen.')}</p>{selected.ccu&&<p>{t('Pledge')}: {selected.ccu.pledgeId} · {t('Exemplar')}: {selected.ccu.instanceId}{selected.ccu.protected?' · '+t('Geschützt'):''}</p>}</div><button aria-label={t('CCU-Details schließen')} onClick={()=>setDetail(null)}>×</button></div>}
    <details className="ccu-evidence"><summary>{t('Planungsgrundlagen')}</summary><p>{t('Anwendbarkeit ungeprüft. Eigene Entwürfe ändern weder Bestand noch Schutzwerte. Vorrang gilt lokal für die ausgewählten Ziele. Varianten eines Ziels bleiben Alternativen.')}</p>
      <p>{t('Fehlende Werte bleiben ungeprüft. Rot markierte Anschlüsse sind kein gültiger Vorwärtsweg. Bei manuellen Entwürfen bleiben deine gewählten Schritte erhalten.')}</p></details>
    </div>
    </div>
    {advisors&&<div ref={advisorPanel} tabIndex={-1} className="ccu-advisor-context" hidden={advisorTab==='chain'}><PlanningAdvisors context={advisors} tab={advisorTab==='purchase'?'purchase':'conflicts'} fairOffer={fairOffer}/></div>}
  </section>;
}
