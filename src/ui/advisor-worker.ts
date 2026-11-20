import {advisePortfolio,advisePurchase,type AdvisorInput} from '../planner/advisor';
import type {TargetOffer} from '../market/model';
self.onmessage=(event:MessageEvent<{input:AdvisorInput;offer?:TargetOffer}>)=>{try{const {input,offer}=event.data;self.postMessage({ok:true,result:offer?advisePurchase(input,offer):advisePortfolio(input)});}catch{self.postMessage({ok:false});}};
