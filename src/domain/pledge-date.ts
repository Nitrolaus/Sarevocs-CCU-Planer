import type {Pledge} from './model';
/** Calendar date as RSI displays it. No invented timezone, payment or original gift-purchase claim. */
export function pledgeDate(pledge:Pick<Pledge,'sourceValues'>):string|null{
 const raw=pledge.sourceValues.date;if(typeof raw!=='string'||raw.length>120)return null;
 const s=raw.trim().replace(/\s+/g,' ').replace(/^(?:Created|Erstellt)\s*:\s*/i,'');let year:number,month:number,day:number;
 const time=/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?/i.exec(s);
 if(time&&(Number(time[2])>59||Number(time[3]??0)>59||Number(time[1])>(time[4]?12:23)||time[4]&&Number(time[1])<1))return null;
 const iso=/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(s);
 const de=/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,? \d{1,2}:\d{2})?$/.exec(s);
 const en=/^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})(?:,? \d{1,2}:\d{2}(?: ?[ap]m)?)?$/i.exec(s);
 if(iso){year=+iso[1]!;month=+iso[2]!;day=+iso[3]!;}
 else if(de){year=+de[3]!;month=+de[2]!;day=+de[1]!;}
 else if(en){year=+en[3]!;month=[['jan','january'],['feb','february'],['mar','march'],['apr','april'],['may'],['jun','june'],['jul','july'],['aug','august'],['sep','september'],['oct','october'],['nov','november'],['dec','december']].findIndex(names=>names.includes(en[1]!.toLowerCase()))+1;day=+en[2]!;}
 else return null;
 const value=new Date(Date.UTC(year,month-1,day));if(year<2012||year>2100||month<1||month>12||value.getUTCFullYear()!==year||value.getUTCMonth()!==month-1||value.getUTCDate()!==day)return null;
 return String(year)+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
}
export function pledgeDateLabel(pledge:Pick<Pledge,'sourceValues'>,language:'de'|'en',short=false):string|null{
 const date=pledgeDate(pledge);if(!date)return null;const [y,m,d]=date.split('-');return language==='de'?d+'.'+m+'.'+(short?y!.slice(-2):y):date;
}
/** Newest source calendar date first; source clock breaks ties, unknown dates last, equal keys stable. */
export function comparePledgeDates(a:Pick<Pledge,'sourceValues'>|undefined,b:Pick<Pledge,'sourceValues'>|undefined):number{
 const key=(p:Pick<Pledge,'sourceValues'>|undefined)=>{const date=p?pledgeDate(p):null;if(!date)return '';const time=/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?/i.exec(p!.sourceValues.date??'');if(!time)return date;const hour=time[4]?Number(time[1])%12+(time[4].toLowerCase()==='pm'?12:0):Number(time[1]);return date+'T'+String(hour).padStart(2,'0')+':'+time[2]+':'+(time[3]??'00');};
 return key(b).localeCompare(key(a));
}
