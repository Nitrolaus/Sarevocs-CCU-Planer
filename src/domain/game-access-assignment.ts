import type {Pledge} from './model';

export type AccessGame='sc'|'sq42';
export type AccessAssignment={state:'unknown'|'declared'|'observed';games:AccessGame[]};

/** An included download, ship count or local protection flag never proves RSI's assignment. */
export function gameAccessAssignment(pledge:Pick<Pledge,'sourceValues'>,source:string):AccessAssignment {
  const raw=pledge.sourceValues.gameAccessAssignment;
  if(typeof raw!=='string'||raw.length>100)return {state:'unknown',games:[]};
  try {
    const games:unknown=JSON.parse(raw);
    if(!Array.isArray(games)||games.length>2||games.some(v=>v!=='sc'&&v!=='sq42')||new Set(games).size!==games.length)return {state:'unknown',games:[]};
    return {state:source==='rsi-dom-probe/1'?'observed':'declared',games:games as AccessGame[]};
  }catch{return {state:'unknown',games:[]};}
}

export function hasProtectedGameAccess(pledge:Pick<Pledge,'sourceValues'>,source:string):boolean {
  const value=gameAccessAssignment(pledge,source);
  return value.state==='observed'&&value.games.length>0;
}
