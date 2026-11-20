import {useEffect,useRef,useState} from 'react';
import type {AdvisorInput,PortfolioAdvice,PurchaseAdvice} from '../planner/advisor';import type {TargetOffer} from '../market/model';
export function useAdvisor<T extends PortfolioAdvice|PurchaseAdvice>(input:AdvisorInput|null,signature:string){
 const [state,setState]=useState<{signature:string;pending:boolean;result:T|null;error:boolean}>({signature:'',pending:false,result:null,error:false});
 const epoch=useRef(0),worker=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const stop=()=>{epoch.current++;worker.current?.terminate();worker.current=null;clearTimeout(timer.current);};
 useEffect(()=>{stop();return stop;},[signature]);
 function run(offer?:TargetOffer){stop();if(!input)return;const n=epoch.current;setState({signature,pending:true,result:null,error:false});
  const finish=(result:T|null,error=false)=>{if(n!==epoch.current)return;worker.current?.terminate();worker.current=null;clearTimeout(timer.current);setState({signature,pending:false,result,error});};
  try{const job=worker.current=new Worker(new URL('./advisor-worker.js',window.location.href),{type:'module'});job.onmessage=e=>finish(e.data?.ok?e.data.result:null,!e.data?.ok);job.onerror=e=>{e.preventDefault();finish(null,true);};timer.current=setTimeout(()=>finish(null,true),25000);job.postMessage({input,offer});}catch{finish(null,true);}
 }
 return {...(state.signature===signature?state:{signature,pending:false,result:null,error:false}),run};
}
