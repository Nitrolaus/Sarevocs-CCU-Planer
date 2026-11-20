import React,{useId} from 'react';
/** Original vector artwork: alternating face-on and edge-on silver links. */
export function ChainLink({broken=false,label}:{broken?:boolean;label:string}){
  const id='silver-'+useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const rings=[0,10,20,30].filter(x=>!broken||x!==20);
  return <svg className="ccu-silver-chain" role="img" aria-label={label} viewBox="0 0 58 26" preserveAspectRatio="none">
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">{[['0','#535f6a'],['.14','#abb8c1'],['.28','#f7fbff'],['.42','#d3dce2'],['.55','#71828e'],['.72','#bac8d1'],['.86','#edf3f6'],['1','#647580']].map(([offset,color])=><stop key={offset} offset={offset} stopColor={color}/>)}</linearGradient></defs>
    <g transform="translate(1 13)">{rings.map((x,i)=>{const h=i%2?5.5:12;return <g key={x} className="ccu-metal-ring"><rect x={x} y={-h/2+1.8} width="19" height={h} rx={h/2} fill="none" stroke="#02090e" strokeOpacity=".8" strokeWidth="5"/>
      <rect x={x} y={-h/2} width="19" height={h} rx={h/2} fill="none" stroke="#26333d" strokeWidth="5"/><rect x={x} y={-h/2} width="19" height={h} rx={h/2} fill="none" stroke={'url(#'+id+')'} strokeWidth="3.4"/>
      <path d={'M'+(x+h/2)+' '+(-h/2+1.1)+'H'+(x+19-h/2)} fill="none" stroke="#f5fbff" strokeOpacity=".8" strokeWidth=".65" strokeLinecap="round"/></g>;})}
      <path d="M49 -5l6 5-6 5" fill="none" stroke="#25333e" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/><path d="M49 -5l6 5-6 5" fill="none" stroke={'url(#'+id+')'} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
    </g>{broken&&<path className="ccu-broken-mark" d="M25 9l3 4-3 4m6-8 3 4-3 4" fill="none" stroke="currentColor" strokeWidth="1.5"/>}
  </svg>;
}
