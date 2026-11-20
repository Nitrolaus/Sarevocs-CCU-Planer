import {useEffect,useRef,useState} from 'react';
import {DEFAULT_PRIORITIES,movePriority,priorityOrderSchema,type PriorityOrder} from '../planner/reservations';
type State={accountId:string|null;order:PriorityOrder;ready:boolean;saving:boolean;error:string};
const empty=(accountId:string|null):State=>({accountId,order:[...DEFAULT_PRIORITIES],ready:false,saving:false,error:''});
export function usePlannerPriorities(accountId:string|null){
 const [state,setState]=useState<State>(()=>empty(null)),generation=useRef(0),scope=useRef(accountId);scope.current=accountId;
 useEffect(()=>{const epoch=++generation.current;setState(empty(accountId));if(accountId)void window.ccu.request({action:'planner.priorities',accountId}).then(r=>{if(!r.ok)throw Error('LOAD');const order=priorityOrderSchema.parse(r.data);if(scope.current===accountId&&generation.current===epoch)setState({accountId,order,ready:true,saving:false,error:''});}).catch(()=>{if(scope.current===accountId&&generation.current===epoch)setState({...empty(accountId),error:'Gespeicherter Vorrang ist nicht lesbar.'});});return()=>{generation.current++;};},[accountId]);
 const current=state.accountId===accountId?state:empty(accountId);
 function change(slot:number,rank:number){if(!accountId||!current.ready||current.saving)return;const epoch=generation.current,order=movePriority(current.order,slot,rank);setState({...current,saving:true,error:''});
  void window.ccu.request({action:'planner.priorities',accountId,order}).then(r=>{if(!r.ok)throw Error('SAVE');const saved=priorityOrderSchema.parse(r.data);if(scope.current===accountId&&generation.current===epoch)setState({accountId,order:saved,ready:true,saving:false,error:''});}).catch(()=>{if(scope.current===accountId&&generation.current===epoch)setState({...current,saving:false,error:'Vorrang konnte nicht gespeichert werden.'});});
 }
 return {...current,change};
}
