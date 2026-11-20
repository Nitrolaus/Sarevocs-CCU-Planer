import {searchChains,type SearchInput} from '../planner/search';
self.onmessage=(event:MessageEvent<SearchInput>)=>{try{self.postMessage({ok:true,result:searchChains(event.data,{observedPrices:true})});}catch{self.postMessage({ok:false});}};
