import React, {useEffect, useMemo, useState} from 'react';
import type {Pledge} from '../domain/model';
import type {GiveawayOriginsSnapshot} from '../storage/giveaway-origins';
import type {MarketSnapshot} from '../market/model';
import {shopPairKey, type ShopPair} from '../market/shop-prices';
import type {PricingSnapshot} from '../pricing/model';
import {gameAccessEvidence} from '../domain/game-access';
import {gameContentKind} from '../domain/game-content';
import {gameAccessAssignment} from '../domain/game-access-assignment';
import {hasInventoryReadIssue} from '../domain/inventory-issues';
import {catalogueIdentity} from '../market/ship-values';
import {pledgeDateLabel} from '../domain/pledge-date';
import {inventoryAcquisitionPrice, currentShipValues, convertPurchaseValue, sameStandaloneShip, standaloneModel,
  RSI_ORDER_PRICE, RSI_LOG_PRICE, type CurrentShipValue} from '../pricing/inventory-values';
import {estimateMinor, euroRateIsStale, formatMinor} from '../pricing/money';
import {ccuInsuranceDisplay} from './ccu-insurance';
import {gameCopyLabel, npcEvidenceNote} from './game-packages';
import {useText} from './i18n';
import './ship-values.css';
import {ResizableTable} from './ResizableTable';
import {GiveawayOriginDialog} from './GiveawayOriginDialog';
import {giveawayShip} from '../domain/giveaway';
import { CcuShopPrice, ccuShopPair, type DisplayShopPrice } from './CcuShopPrice';
import { useShopPricePairs } from './useShopPrices';

type Row = {pledge:Pledge; source:string};
const ccuModelKey = (from:string,to:string) => JSON.stringify([from,to]);
type DisplayRow = CurrentShipValue & {ccu?:Pledge['ccus'][number]; ship:boolean};
type Props = {
  accountId:string; rows:readonly Row[]; display:PricingSnapshot; demo:boolean; view?:'ships'|'all'|'ccus'|'packages'|'access';emptyText?:string;
  titleFor:(p:Pledge)=>string; crownFor:(p:Pledge)=>React.ReactNode; statusFor:(p:Pledge)=>string|null;
  sourceLabel:(source:string)=>string; onHistory:(p:Pledge)=>void;
};

export function ShipValueTable({accountId,rows,display,demo,view='ships',emptyText,titleFor,crownFor,statusFor,sourceLabel,onHistory}:Props) {
  const t=useText(), [market,setMarket]=useState<MarketSnapshot>();
  const [origins,setOrigins]=useState<GiveawayOriginsSnapshot>();
  const [editing,setEditing]=useState<string>();
  const organizerByPledge=useMemo(()=>new Map(origins?.entries.map(entry=>[entry.pledgeId,entry.organizer])),[origins]);
  useEffect(()=>{
    if(!accountId)return;
    let active=true;
    void window.ccu.request({action:'inventory.giveaways',accountId}).then(result=>{
      if(!active||!result.ok)return;
      const snapshot=result.data as GiveawayOriginsSnapshot;
      if(snapshot?.accountId===accountId&&Array.isArray(snapshot.entries))setOrigins(snapshot);
    }).catch(()=>{});
    return ()=>{active=false;};
  },[accountId]);
  async function saveOrigin(pledgeId:string,organizer:string){
    const result=await window.ccu.request({action:'inventory.giveaways',accountId,edit:{pledgeId,organizer}});
    if(!result.ok)throw Error('GIVEAWAY_SAVE');
    const snapshot=result.data as GiveawayOriginsSnapshot;
    if(snapshot?.accountId!==accountId||!Array.isArray(snapshot.entries))throw Error('GIVEAWAY_PROFILE');
    setOrigins(snapshot);
  }
  useEffect(()=>{
    let active=true,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {const r=await window.ccu.request({action:'market.status',...(view!=='ships'&&!demo?{includeLastShopPrices:true}: {})});if(active&&r.ok)setMarket(previous=>JSON.stringify(previous)===JSON.stringify(r.data)?previous:r.data as MarketSnapshot);}
      catch {/* Public cache only; never initiate a connection or authentication. */}
      if(active)timer=setTimeout(()=>void poll(),1500);
    };
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[view,demo]);
  const pairsByModel=useMemo(()=>{
    const pairs=new Map<string,ShopPair|null>(),catalogue=market?.catalogue?.ships;
    if (!catalogue||demo||view==='ships') return pairs;
    for(const {pledge} of rows) for(const {from,to} of pledge.ccus){
      const key=ccuModelKey(from,to);
      if(!pairs.has(key)) pairs.set(key,ccuShopPair(from,to,catalogue));
    }
    return pairs;
  },[rows,market?.catalogue?.ships,view,demo]);
  const wantedPairs=new Map<string,ShopPair>();
  for(const pair of pairsByModel.values()) if(pair) wantedPairs.set(shopPairKey(pair),pair);
  useShopPricePairs([...wantedPairs.values()]);
  const quotesByPair=useMemo(()=>{
    const grouped=new Map<string,Map<string,DisplayShopPrice>>();
    for(const [prices,current] of [[market?.lastShopPrices,false],[market?.shopPrices,true]] as const){
      for(const price of prices??[]){
        const key=shopPairKey(price),entries=grouped.get(key)??new Map<string,DisplayShopPrice>();
        entries.set(price.edition,{...price,current});
        grouped.set(key,entries);
      }
    }
    return new Map([...grouped].map(([key,entries])=>[key,[...entries.values()].sort((a,b)=>a.edition.localeCompare(b.edition))]));
  },[market?.lastShopPrices,market?.shopPrices]);
  const fx=display.rate&&!euroRateIsStale(display.rate)?display.rate:null;
  const comparisonSettings={...display.settings,taxMode:'net' as const};
  const money=(n:number,currency:'USD'|'EUR',approximate=false)=>(approximate?'≈ ':'')+formatMinor(n,currency,display.settings.language);
  const maker=(name:string)=>{const identity=catalogueIdentity(name,market?.catalogue?.ships??[]);return identity?.manufacturerCode==='RSI'?'RSI':identity?.manufacturer||t('Nicht belegt');};
  const isGameView=view==='packages'||view==='access';

  const labels=[t(view==='ships'?'Schiff / Fahrzeug':isGameView?'Paket / Zugang':'Gegenstand / Upgrade'),t('Hersteller'),t('Versicherung'),t('Art / Hinweise'),t('Kaufpreis beim Erwerb'),t(view==='ccus'?'RSI-Shoppreis':'Aktueller Kaufpreis'),t('Herkunft / Datum')];
  const columns=labels.map((label,i)=>({label,min:[160,90,70,90,135,125,90][i]!,preferred:[310,160,100,170,150,145,135][i]!,autoLimit:[920,680,240,680,420,480,420][i]!}));
  return <><ResizableTable columns={columns} storageKey="inventory" className="inventory-table ship-value-table compact-inventory" label={t(view==='ships'?'Schiffswerte':'Bestand')}><tbody>
    {rows.flatMap(({pledge:p,source})=>{
      const cost=inventoryAcquisitionPrice(p,source,market?.catalogue?.ships),converted=convertPurchaseValue(cost.value,display),status=statusFor(p);
      const access=gameAccessEvidence(p),gameKind=gameContentKind(p),assignment=gameAccessAssignment(p,source),issue=hasInventoryReadIssue(p),unresolved=p.sourceValues.upgradeState==='unresolved';
      const protectedLabel=assignment.state==='observed'?assignment.games.map(g=>g==='sc'?'SC Game Access':'SQ42 Game Access').join(' + '):'';
      const placeholder=(name:string,childId:string):DisplayRow=>({name,childId,usdMinor:null,observedAt:null,source:'unavailable',ship:false});
      const values:DisplayRow[]=view==='ccus'||(view!=='ships'&&p.ccus.length)
        ? p.ccus.length?p.ccus.map(c=>({...placeholder(c.from+' → '+c.to,c.instanceId),ccu:c})):[placeholder(p.name,p.pledgeId)]
        : p.ships.length?currentShipValues(p,market).map(s=>({...s,ship:true})):[placeholder(p.name,p.pledgeId)];
      const purchaseAmount=cost.value?money(converted.minor??cost.value.minor,converted.minor===null?cost.value.currency:display.settings.currency,
        cost.kind==='rsi-pledge'||converted.minor!==null&&converted.approximate):null;
      const evidence=cost.value?.evidence;
      const fromLog=evidence===RSI_LOG_PRICE, fromOrder=evidence===RSI_ORDER_PRICE;
      const originalPrice=(fromLog||fromOrder)&&p.ships.length===1&&!!standaloneModel(p)&&!sameStandaloneShip(p,market?.catalogue?.ships);
      const packagePrice=(fromLog||fromOrder)&&p.ships.length>0&&!standaloneModel(p);
      const organizer=organizerByPledge.get(p.pledgeId);
      const giveaway=giveawayShip(p);
      const date=pledgeDateLabel(p,display.settings.language,true);
      const longDate=pledgeDateLabel(p,display.settings.language);
      const originLabel=(demo?'DEMO · ':'')+(source==='rsi-dom-probe/1'?'RSI':t('Import'))+(date?' · '+date:'');
      const giveawayLabel=organizer?t('Giveaway von')+' '+organizer:giveaway?'Giveaway':null;
      const originTitle=[(demo?'DEMO · ':'')+sourceLabel(source),longDate?t('Erhalten am (RSI)')+': '+longDate+' · '+t('Kein Beleg des persönlichen Kaufdatums.'):null,
        giveawayLabel,organizer?t('Eigene Angabe'):null].filter(Boolean).join('\n');
      const purchaseTitle=[t(fromLog?RSI_LOG_PRICE:fromOrder?RSI_ORDER_PRICE:cost.kind==='rsi-pledge'?'RSI-Hangarwert als Richtwert für den Erwerb.':cost.kind==='recorded'?'Erfasster Kaufpreis.':'Kaufpreis beim Erwerb nicht belegt.'),
        cost.value?money(cost.value.minor,cost.value.currency):null,p.name,originalPrice?t('Kaufpreis des ursprünglichen Eintrags vor späteren Upgrades.'):null,
        values.length>1?t('Gemeinsamer Paketwert, kein Einzelpreis je Schiff.'):null].filter(Boolean).join('\n');
      return values.map((value,index)=>{
        const today=estimateMinor(value.usdMinor,comparisonSettings,fx),name=isGameView?p.name+(value.ship?' · '+value.name:''):value.name;
        const currentPrice=value.usdMinor===null?null:money(today??value.usdMinor,today===null?'USD':display.settings.currency,true);
        const currentTitle=value.ship?[
          t('RSI-Standardpreis des Modells. Der im Shop angezeigte Endbetrag kann abweichen.'),
          value.usdMinor===null?null:money(value.usdMinor,'USD'),
          value.observedAt?t('Datenstand')+': '+new Intl.DateTimeFormat(display.settings.language==='de'?'de-DE':'en-GB',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Berlin'}).format(new Date(value.observedAt)):null,
        ].filter(Boolean).join('\n'):undefined;
        const ccuInsurance=value.ccu||unresolved?ccuInsuranceDisplay(p):null;
        const pair=value.ccu?pairsByModel.get(ccuModelKey(value.ccu.from,value.ccu.to)):null;
        const type=gameKind?t(gameKind==='package'?'Spielpaket':'Spielkopie')+' · '+gameCopyLabel(access)
          :value.ccu?'CCU · '+t(value.ccu.status==='unused'?'unbenutzt':value.ccu.status==='applied'?'angewendet':'ungeprüft')
          :unresolved?'CCU':value.ship?t('Schiff / Fahrzeug'):t('Gegenstand');
        const typeTitle=type+'\n'+(gameKind?npcEvidenceNote(p,access)+'\n':'')+(protectedLabel?t('RSI-Hangar: geschützter Spielzugang. Nicht einschmelzbar oder verschenkbar.')+'\n'+protectedLabel:assignment.state==='unknown'?t('RSI-Zugangsmarkierungen noch nicht eingelesen.'):t('Keine geschützte RSI-Zugangsmarkierung gelesen.'))+
          (issue?'\n'+t('Lese- oder Zuordnungsproblem erkannt.'): '');
        return <tr key={p.pledgeId+':'+value.childId} data-pledge={p.pledgeId} data-child={value.childId} data-read-issue={issue||undefined}>
          <td tabIndex={0} title={name+'\n'+titleFor(p)+'\nPledge: '+p.pledgeId+(value.ccu?'\n'+t('Exemplar')+': '+value.ccu.instanceId:'')}
            onMouseEnter={()=>onHistory(p)} onFocus={()=>onHistory(p)}><span className="ship-current-model">{crownFor(p)}<span>{name}</span></span></td>
          <td className="ship-manufacturer" title={value.ccu?maker(value.ccu.from)+' → '+maker(value.ccu.to):value.ship?catalogueIdentity(value.name,market?.catalogue?.ships??[])?.manufacturer:undefined}>
            {value.ccu?maker(value.ccu.from)+' → '+maker(value.ccu.to):value.ship?maker(value.name):'—'}</td>
          <td>{ccuInsurance?<span className={'badge '+(['months','check'].includes(ccuInsurance.tone)?'unknown':'')} title={ccuInsurance.title}>{t(ccuInsurance.label)}</span>
            :value.ship?<span className={'badge '+(p.insurance.kind==='lti'?'':'unknown')} title={p.insurance.kind==='lti'?'LTI':p.insurance.kind==='months'?p.insurance.months+' '+t('Monate'):t('Unbekannt')}>{p.insurance.kind==='lti'?'LTI':p.insurance.kind==='months'?p.insurance.months+' '+t('Monate'):t('Unbekannt')}</span>:'—'}</td>
          <td className="inventory-kind" title={typeTitle}>{type}{protectedLabel?<small className="game-protected-access">🔒 {protectedLabel}{status==='Nur upgraden'?' · '+t(status):''}</small>:issue?<small className="inventory-issue">{t('Zuordnung prüfen')}</small>
            :status==='Nur upgraden'?<small className="ship-access">{t(status)}</small>:gameKind?<small>{t('NPC nicht bestätigt')}</small>:null}</td>
          {index===0&&<td className="ship-price ship-purchase" rowSpan={values.length} title={purchaseTitle}>
            <strong>{purchaseAmount??t('Nicht belegt')}</strong>
            {purchaseAmount&&values.length>1&&<small className="ship-package-total">{t('Paketgesamt')} ({values.length})</small>}
            {purchaseAmount&&values.length===1&&(originalPrice||packagePrice||fromLog)&&<small className="ship-package-total">
              {t(originalPrice?'Ursprungspreis':packagePrice?'Paketpreis beim Erwerb':'RSI-Protokollwert')}
            </small>}
          </td>}
          <td className="ship-price ship-current-value" title={currentTitle}>
            {value.ship?<strong>{currentPrice??t('Nicht verfügbar')}</strong>:pair
              ? <CcuShopPrice prices={quotesByPair.get(shopPairKey(pair))??[]} language={display.settings.language} />
              : value.ccu&&!demo?t('Paar ungeklärt'):'—'}
          </td>
          <td className="ship-source" title={originTitle}>
            <div className="ship-origin-line">
              {value.ship&&value.childId===giveaway?.childId&&<button type="button" className="giveaway-pencil"
                disabled={!origins} aria-label={t('Giveaway-Herkunft bearbeiten')+' · '+value.name} onClick={()=>setEditing(p.pledgeId)}>✎</button>}
              <span>{value.ship?giveawayLabel??originLabel:originLabel}</span>
            </div>
          </td>
        </tr>;
      });
    })}
    {!rows.length&&<tr><td colSpan={7} className="empty">{emptyText??t('Keine Gegenstände für diesen Filter.')}</td></tr>}
  </tbody></ResizableTable>
  {editing&&<GiveawayOriginDialog key={editing} initial={organizerByPledge.get(editing)??''}
    onSave={name=>saveOrigin(editing,name)} onClose={()=>setEditing(undefined)}/>}
  </>;
}
