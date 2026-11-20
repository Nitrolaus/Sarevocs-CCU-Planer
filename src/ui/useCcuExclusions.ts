import {useEffect,useRef,useState} from 'react';import {excludedCcusSchema} from '../planner/exclusions';
type State={accountId:string|null;keys:string[];ready:boolean;saving:boolean;error:string};
const empty=(accountId:string|null):State=>({accountId,keys:[],ready:false,saving:false,error:''});
export function useCcuExclusions(accountId:string|null){
 const [state,setState]=useState<State>(()=>empty(null)),generation=useRef(0),scope=useRef(accountId);scope.current=accountId;
 useEffect(()=>{const epoch=++generation.current;setState(empty(accountId));if(accountId)void window.ccu.request({action:'planner.exclusions',accountId}).then(r=>{if(!r.ok)throw Error('LOAD');const keys=excludedCcusSchema.parse(r.data);if(scope.current===accountId&&generation.current===epoch)setState({accountId,keys,ready:true,saving:false,error:''});}).catch(()=>{if(scope.current===accountId&&generation.current===epoch)setState({...empty(accountId),error:'CCU-Sperren konnten nicht geladen werden.'});});return()=>{generation.current++;};},[accountId]);
 const current=state.accountId===accountId?state:empty(accountId);
 function toggle(key:string){if(!accountId||!current.ready||current.saving)return;const epoch=generation.current;setState({...current,saving:true,error:''});void window.ccu.request({action:'planner.exclude',accountId,ccuKey:key,excluded:!current.keys.includes(key)}).then(r=>{if(!r.ok)throw Error('SAVE');const keys=excludedCcusSchema.parse(r.data);if(scope.current===accountId&&generation.current===epoch)setState({accountId,keys,ready:true,saving:false,error:''});}).catch(()=>{if(scope.current===accountId&&generation.current===epoch)setState({...current,ready:false,saving:false,error:'CCU-Sperre konnte nicht gespeichert werden.'});});
 }
 return {...current,toggle};
}
