import {useEffect,useRef,useState} from 'react';
import {draftSchema,emptyDraft,type PlannerDraft} from '../planner/draft';
type Entry={value:PlannerDraft;ready:boolean;saving:boolean;error:string;history:PlannerDraft[]};
export type DraftEditor={value:PlannerDraft;ready:boolean;saving:boolean;error:string;canUndo:boolean;change:(value:PlannerDraft)=>void;undo:()=>void};
const fresh=():Entry=>({value:emptyDraft(),ready:false,saving:false,error:'',history:[]});
export function usePlannerDrafts(accountId:string|null,targets:readonly(number|null)[]){
  const [state,setState]=useState<{accountId:string|null;entries:Record<number,Entry>}>({accountId:null,entries:{}});
  const current=useRef(state),scope=useRef(accountId),sequence=useRef(new Map<string,number>()),batch=useRef(false);current.current=state;scope.current=accountId;
  const targetKey=targets.filter((id):id is number=>id!==null).join(',');
  function put(id:number,value:Entry,account=accountId){if(scope.current!==account)return;
    const before=current.current.accountId===account?current.current.entries:{};const next={accountId:account,entries:{...before,[id]:value}};
    current.current=next;setState(next);
  }
  useEffect(()=>{
    let active=true;if(!accountId){const next={accountId:null,entries:{}};current.current=next;setState(next);return;}
    for(const id of targets){if(id===null||current.current.accountId===accountId&&current.current.entries[id]?.ready)continue;
      void window.ccu.request({action:'planner.draft',accountId,targetId:id}).then(result=>{
        if(!active||scope.current!==accountId)return;if(!result.ok)throw Error('LOAD');
        const value=result.data===null?emptyDraft():draftSchema.parse(result.data);put(id,{...fresh(),value,ready:true},accountId);
      }).catch(()=>{if(active&&scope.current===accountId)put(id,{...fresh(),ready:true,error:'Gespeicherter Entwurf ist nicht lesbar.'},accountId);});
    }
    return()=>{active=false;};
  },[accountId,targetKey]);
  function persist(id:number,entry:Entry){if(!accountId)return;const account=accountId,key=account+':'+id,seq=(sequence.current.get(key)??0)+1;sequence.current.set(key,seq);put(id,{...entry,saving:true,error:''});
    void window.ccu.request({action:'planner.draft',accountId:account,targetId:id,draft:entry.value}).then(result=>{
      if(!result.ok)throw Error('SAVE');if(scope.current===account&&current.current.accountId===account&&sequence.current.get(key)===seq){const live=current.current.entries[id];if(live)put(id,{...live,saving:false,error:''},account);}
    }).catch(()=>{if(scope.current===account&&current.current.accountId===account&&sequence.current.get(key)===seq){const live=current.current.entries[id];if(live)put(id,{...live,saving:false,error:'Entwurf konnte nicht gespeichert werden.'},account);}});
  }
  const entries=state.accountId===accountId?state.entries:{};
  function editor(id?:number):DraftEditor{
    const entry=id!==undefined?entries[id]??fresh():fresh();
    return {value:entry.value,ready:entry.ready,saving:entry.saving,error:entry.error,canUndo:!!entry.history.length,
      change(value){if(id===undefined||!accountId||batch.current)return;const live=current.current.accountId===accountId?current.current.entries[id]:undefined;if(!live?.ready)return;
        const parsed=draftSchema.safeParse(value);if(!parsed.success){put(id,{...live,error:'Maximal 100 Schritte; jedes CCU-Exemplar nur einmal.'});return;}
        persist(id,{...live,value:parsed.data,history:[...live.history,structuredClone(live.value)].slice(-20)});
      },undo(){if(id===undefined||!accountId||batch.current||current.current.accountId!==accountId)return;const live=current.current.entries[id];if(!live?.history.length)return;
        persist(id,{...live,value:live.history.at(-1)!,history:live.history.slice(0,-1)});
      }};
  }
  async function applyBatch(values:{targetId:number;draft:PlannerDraft}[]):Promise<boolean>{
    if(!accountId||batch.current||scope.current!==accountId||current.current.accountId!==accountId)return false;
    const account=accountId,rows=values.map(row=>({...row,expected:current.current.entries[row.targetId]?.value}));
    if(rows.some(r=>!r.expected||!current.current.entries[r.targetId]?.ready||current.current.entries[r.targetId]?.saving||current.current.entries[r.targetId]?.error))return false;
    batch.current=true;
    for(const row of rows){const live=current.current.entries[row.targetId]!;put(row.targetId,{...live,saving:true},account);}
    try{const result=await window.ccu.request({action:'planner.batch',accountId:account,entries:rows as {targetId:number;draft:PlannerDraft;expected:PlannerDraft}[]});if(!result.ok)throw Error('SAVE');
      if(scope.current!==account||current.current.accountId!==account)return false;
      for(const row of rows){const live=current.current.entries[row.targetId]!;put(row.targetId,{...live,value:row.draft,saving:false,error:'',history:[...live.history,structuredClone(live.value)].slice(-20)},account);}return true;
    }catch{if(scope.current===account&&current.current.accountId===account)for(const row of rows){const live=current.current.entries[row.targetId]!;put(row.targetId,{...live,saving:false,error:'Entwurf konnte nicht gespeichert werden.'},account);}return false;
    }finally{batch.current=false;}
  }
  return {entries,editor,applyBatch};
}
