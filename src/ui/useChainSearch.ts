import {useEffect,useRef,useState} from 'react';
import type {SearchInput,SearchResult} from '../planner/search';
type SearchState={signature:string;pending:boolean;result:SearchResult|null;error:boolean};
export function useChainSearch(input:SearchInput|null,signature:string){
  const [state,setState]=useState<SearchState>({signature:'',pending:false,result:null,error:false}),sequence=useRef(0),worker=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const stop=()=>{sequence.current++;worker.current?.terminate();worker.current=null;clearTimeout(timer.current);};
  useEffect(()=>{stop();setState({signature,pending:false,result:null,error:false});return stop;},[signature]);
  function run(){stop();if(!input)return;const generation=sequence.current;setState({signature,pending:true,result:null,error:false});
    const finish=(result:SearchResult|null,error=false)=>{if(sequence.current!==generation)return;worker.current?.terminate();worker.current=null;clearTimeout(timer.current);setState({signature,pending:false,result,error});};
    try{const job=worker.current=new Worker(new URL('./planner-worker.js',window.location.href),{type:'module'});job.onmessage=event=>finish(event.data?.ok===true?event.data.result:null,event.data?.ok!==true);job.onerror=event=>{event.preventDefault();finish(null,true);};
      timer.current=setTimeout(()=>finish(null,true),10000);job.postMessage(input);
    }catch{finish(null,true);}
  }
  return {...(state.signature===signature?state:{signature,pending:false,result:null,error:false}),run};
}
