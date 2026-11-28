import React,{useId}from'react';
export const conciergeBadgeRanks=['High Admiral','Grand Admiral','Space Marshal','Wing Commander','Praetorian','Legatus Navium'] as const;
export function hasConciergeBadge(rank:string|null|undefined){return conciergeBadgeRanks.some(name=>name===rank);}
function star(x:number,y:number,s:number){return 'M'+x+' '+(y-s)+'L'+(x+s*.28)+' '+(y-s*.28)+'L'+(x+s)+' '+y+'L'+(x+s*.28)+' '+(y+s*.28)+'L'+x+' '+(y+s)+'L'+(x-s*.28)+' '+(y+s*.28)+'L'+(x-s)+' '+y+'L'+(x-s*.28)+' '+(y-s*.28)+'Z';}
/** Original project artwork. Exact reported ranks only; never infer a rank from spending. */
export function ConciergeBadge({rank}:{rank:string}){
 const uid='ccu-rank-'+useId().replace(/[^a-zA-Z0-9_-]/g,''),level=conciergeBadgeRanks.findIndex(name=>name===rank)+1;
 if(!level)return null;
 const ref=(name:string)=>'url(#'+uid+'-'+(level===5&&name==='gold'?'silver':level===6&&name==='silver'?'gold':name)+')';
 return <svg className="concierge-insignia" style={{aspectRatio:'1'}} viewBox={level<4?'0 0 320 320':'-24 0 408 280'} fill="none" aria-hidden="true" data-concierge-level={level}>
 <defs>
 <linearGradient id={uid+"-gold"} x1="30" y1="30" x2="270" y2="280" gradientUnits="userSpaceOnUse"><stop stopColor="#6e4820"/><stop offset=".19" stopColor="#fff1b6"/><stop offset=".30" stopColor="#b48037"/><stop offset=".46" stopColor="#f4d185"/><stop offset=".59" stopColor="#805121"/><stop offset=".76" stopColor="#edc674"/><stop offset="1" stopColor="#815728"/></linearGradient>
 <linearGradient id={uid+"-leaf"} x1="0" y1="0" x2="22" y2="42" gradientUnits="userSpaceOnUse"><stop stopColor="#72512a"/><stop offset=".35" stopColor="#fff1c2"/><stop offset=".47" stopColor="#c9a059"/><stop offset=".56" stopColor="#805320"/><stop offset=".87" stopColor="#edc477"/><stop offset="1" stopColor="#6d461e"/></linearGradient>
 <linearGradient id={uid+"-silver"} x1="90" y1="52" x2="220" y2="275" gradientUnits="userSpaceOnUse"><stop stopColor="#f5ffff"/><stop offset=".19" stopColor="#718892"/><stop offset=".28" stopColor="#f0fbfb"/><stop offset=".48" stopColor="#8fa4ac"/><stop offset=".56" stopColor="#23343e"/><stop offset=".78" stopColor="#c0d5d9"/><stop offset="1" stopColor="#667e86"/></linearGradient>
 <linearGradient id={uid+"-enamel"} x1="105" y1="47" x2="217" y2="258" gradientUnits="userSpaceOnUse"><stop stopColor="#254956"/><stop offset=".22" stopColor="#0c2e40"/><stop offset=".62" stopColor="#071e2d"/><stop offset="1" stopColor="#153d43"/></linearGradient>
 <linearGradient id={uid+"-aqua"} x1="115" y1="111" x2="197" y2="204" gradientUnits="userSpaceOnUse"><stop stopColor="#e3fff6"/><stop offset=".28" stopColor="#a8ffed"/><stop offset=".42" stopColor="#53c9ba"/><stop offset=".49" stopColor="#154c52"/><stop offset=".56" stopColor="#abffed"/><stop offset=".78" stopColor="#369c99"/><stop offset="1" stopColor="#c6fff1"/></linearGradient>
 <linearGradient id={uid+"-shine"} x1="95" y1="55" x2="220" y2="230" gradientUnits="userSpaceOnUse"><stop stopColor="white" stopOpacity=".18"/><stop offset=".5" stopColor="white" stopOpacity="0"/></linearGradient>
 <filter id={uid+"-shadow"} x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dy="7" stdDeviation="6" floodColor="#02070b" floodOpacity=".8"/></filter>
 <filter id={uid+"-glow"} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.1"/></filter>
 <path id={uid+"-laurel"} d="M0 39C-3 19 1 4 15 0C20 13 14 29 0 39Z"/>
</defs>
 {level<4?<g filter={ref('shadow')}>
  <path d="M160 22L249 65L264 94V213L235 245L160 288L85 245L56 213V94L71 65Z" fill={ref('enamel')} stroke={ref('silver')} strokeWidth="9"/>
  <path d="M160 35L239 74L252 98V208L226 235L160 274L94 235L68 208V98L81 74Z" stroke="#6ee2cf" strokeOpacity=".45" strokeWidth="1.4"/>
  <path d="M160 95L171 132L191 122L181 143L218 153L182 164L192 185L171 175L160 213L149 175L128 185L138 164L102 153L139 143L129 122L149 132Z" fill={ref(level===1?'silver':'gold')} stroke="#f3e5b6" strokeWidth="1.2"/>
  <path d="M160 95V153L129 122L149 132Z" fill="#fafff7" fillOpacity=".2"/>
  <path d="M160 135L172 153L160 176L148 153Z" fill={ref('enamel')} stroke={ref('silver')} strokeWidth="1.5"/>
  <path d="M160 142L165 153L160 165L155 153Z" fill={ref('aqua')}/>
  {level===3&&[119,201].map(x=><path key={x} d={star(x,78,13)} fill={ref('silver')} stroke="#e8f3ee" strokeWidth="1"/>)}
  {Array.from({length:level-1},(_,i)=><path key={i} d={'M112 '+(236+i*15)+'H208V'+(243+i*15)+'H112Z'} fill={ref('silver')} stroke="#e1e9e6" strokeWidth=".7"/>)}
 </g>:<><g filter={ref("shadow")}><g transform="translate(156 0) scale(1.25 1) translate(-156 0)"><g strokeLinejoin="round"><path d="M156 110L113 82L18 65L34 88L132 126Z" fill="#142732" stroke="#061017" strokeWidth="5" transform="translate(0 3)"/><path d="M156 110L113 82L18 65L34 88L132 126Z" fill={ref("silver")} stroke="#e3f2ee" strokeWidth="1"/><path d="M138 134L44 107L58 131L145 151Z" fill={ref("silver")} stroke="#07202a" strokeWidth="3.5"/><path d="M136 132L45 107L58 129L143 148" stroke="#d1e7e8" strokeWidth="1"/><path d="M146 157L73 143L87 165L156 174Z" fill={ref("silver")} stroke="#08202a" strokeWidth="3"/><path d="M145 155L74 143L88 163L153 172" stroke="#cee3e4" strokeWidth="1"/><path d="M113 82L18 65L34 88L132 126" stroke={ref("gold")} strokeWidth="2"/></g></g><g transform="translate(360 0) scale(-1 1)"><g transform="translate(156 0) scale(1.25 1) translate(-156 0)"><g strokeLinejoin="round"><path d="M156 110L113 82L18 65L34 88L132 126Z" fill="#142732" stroke="#061017" strokeWidth="5" transform="translate(0 3)"/><path d="M156 110L113 82L18 65L34 88L132 126Z" fill={ref("silver")} stroke="#e3f2ee" strokeWidth="1"/><path d="M138 134L44 107L58 131L145 151Z" fill={ref("silver")} stroke="#07202a" strokeWidth="3.5"/><path d="M136 132L45 107L58 129L143 148" stroke="#d1e7e8" strokeWidth="1"/><path d="M146 157L73 143L87 165L156 174Z" fill={ref("silver")} stroke="#08202a" strokeWidth="3"/><path d="M145 155L74 143L88 163L153 172" stroke="#cee3e4" strokeWidth="1"/><path d="M113 82L18 65L34 88L132 126" stroke={ref("gold")} strokeWidth="2"/></g></g></g>
<path d="M180 54L191 91L211 81L201 102L238 112L202 123L212 144L191 134L180 172L169 134L148 144L158 123L122 112L159 102L149 81L169 91Z" fill="#081924" stroke="#061017" strokeWidth="8" transform="translate(0 4)"/>
<path d="M180 54L191 91L211 81L201 102L238 112L202 123L212 144L191 134L180 172L169 134L148 144L158 123L122 112L159 102L149 81L169 91Z" fill={ref("gold")} stroke="#f2dc9f" strokeWidth="1.6"/>
<path d="M180 54V112L149 81L169 91Z" fill="#fff1c0" fillOpacity=".32"/>
<path d="M180 172V112L212 144L191 134Z" fill="#6c4820" fillOpacity=".3"/>
<path d="M180 97L192 112L180 130L168 112Z" fill={ref("enamel")} stroke={ref("silver")} strokeWidth="2.1"/>
<path d="M180 103L186 112L180 122L174 112Z" fill={ref("aqua")} stroke="#b9fff0" strokeWidth=".7"/>
<path d="M180 7L183.64 16.36L193 20L183.64 23.64L180 33L176.36 23.64L167 20L176.36 16.36Z" fill={ref("silver")} stroke="#dbefe8" strokeWidth=".7"/>
<path d="M78 187Q102 226 142 234M282 187Q258 226 218 234" stroke={ref("gold")} strokeWidth="1.8"/>
<g fill={ref("leaf")} stroke="#b99754" strokeWidth=".7"><path d="M84 195Q68 191 69 177Q83 179 84 195ZM95 207Q77 208 78 192Q91 192 95 207ZM109 218Q91 223 88 208Q102 206 109 218ZM124 227Q109 235 102 221Q117 215 124 227ZM139 233Q127 245 117 231Q129 223 139 233Z"/><g transform="translate(360 0) scale(-1 1)"><path d="M84 195Q68 191 69 177Q83 179 84 195ZM95 207Q77 208 78 192Q91 192 95 207ZM109 218Q91 223 88 208Q102 206 109 218ZM124 227Q109 235 102 221Q117 215 124 227ZM139 233Q127 245 117 231Q129 223 139 233Z"/></g></g>
{Array.from({length:level},(_,i)=><path key={i} d={star(180+(i-(level-1)/2)*23,249,7.5)} fill={ref('silver')} stroke="#dbefe8" strokeWidth=".7"/>)}
</g></>}
 </svg>;
}
