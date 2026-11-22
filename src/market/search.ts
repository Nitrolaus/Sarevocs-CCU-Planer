import type { CatalogueShip } from './model';

export function normalizedShipQuery(value:string):string{
  return value.toLocaleLowerCase('en-US').replace(/ß/g,'ss').replace(/[äöü]/g,c=>({ä:'ae',ö:'oe',ü:'ue'}[c]!))
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\bmk\s*(viii|vii|vi|iv|iii|ii|v|i|\d+)\b/g,(_all,n:string)=>'mk'+({i:1,ii:2,iii:3,iv:4,v:5,vi:6,vii:7,viii:8}[n as 'i']??n))
    .replace(/[^a-z0-9]+/g,' ').trim();
}
function distance(a:string,b:string):number{
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]!+1,row[j]!+1,row[j-1]!+(a[i-1]===b[j-1]?0:1));row=next;}
  return row[b.length]!;
}
export function inventorySearch(query:string):(...fields:string[])=>boolean{
  const words=normalizedShipQuery(query.slice(0,160)).split(' ').filter(Boolean);
  return (...fields)=>{
    if(!words.length)return true;
    const tokens=normalizedShipQuery(fields.join(' ')).split(' ');
    return words.every(word=>tokens.some(token=>{
      if(token.includes(word))return true;
      const threshold=word.length>12?3:word.length>6?2:word.length>=4?1:0;
      return threshold>0&&Math.abs(token.length-word.length)<=threshold&&distance(word,token)<=threshold;
    }));
  };
}
/** Fuzzy suggestions only. Identity joins and the selected variant remain exact. */
export function searchShips(ships:readonly CatalogueShip[],query:string):CatalogueShip[]{
  const q=normalizedShipQuery(query.slice(0,160)),words=q.split(' ').filter(Boolean);
  if(!q)return [...ships].sort((a,b)=>a.name.localeCompare(b.name,'de'));
  return ships.map(ship=>{
    const name=normalizedShipQuery(ship.name),maker=normalizedShipQuery(ship.manufacturer+' '+ship.manufacturerCode),all=(name+' '+maker).split(' ');
    let score=name===q?0:name.startsWith(q)?1:name.includes(q)?2:Infinity;
    if(!Number.isFinite(score)){
      let penalty=0;
      for(const word of words){
        if(all.some(value=>value.includes(word))){penalty+=3;continue;}
        if(word.length<4){penalty=Infinity;break;}
        const threshold=word.length>12?3:word.length>6?2:1;
        const edits=Math.min(...all.filter(value=>Math.abs(value.length-word.length)<=threshold).map(value=>distance(word,value)));
        if(edits>threshold){penalty=Infinity;break;}penalty+=5+edits;
      }
      score=penalty;
    }
    return {ship,score};
  }).filter(row=>Number.isFinite(row.score)).sort((a,b)=>a.score-b.score||a.ship.name.localeCompare(b.ship.name,'de')).map(row=>row.ship);
}
