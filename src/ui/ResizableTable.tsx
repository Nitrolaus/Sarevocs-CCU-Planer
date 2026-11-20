import React,{useEffect,useRef,useState} from 'react';
import {useText} from './i18n';
import type {TableWidthKey} from './table-width-model';

type Column={label:string;header?:React.ReactNode;min:number;preferred:number;autoLimit?:number};
type Props={columns:readonly Column[];storageKey:TableWidthKey;className:string;label:string;children:React.ReactNode};
const maxWidth=2400;
function validWidths(value:unknown,columns:readonly Column[]):number[]|null{
 return Array.isArray(value)&&value.length===columns.length&&value.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=40&&v<=maxWidth)
  ?value.map((v,i)=>Math.max(columns[i]!.min,Math.round(v))):null;
}
function stored(key:string,columns:readonly Column[]):number[]|null {
 try{return validWidths(JSON.parse(localStorage.getItem('ccu.table-widths.v2.'+key)??'null'),columns);}catch{return null;}
}
export function ResizableTable({columns,storageKey,className,label,children}:Props){
 const t=useText(),table=useRef<HTMLTableElement>(null);
 const [widths,setWidths]=useState(()=>stored(storageKey,columns)??columns.map(c=>c.preferred));
 const minimum=columns.map(c=>c.min);
 const drag=useRef<{pointer:number;column:number;start:number;widths:number[]}|null>(null),current=useRef(widths),edits=useRef(0);
 const effective=widths.map((v,i)=>Math.max(v,minimum[i]!));
 current.current=effective;
 useEffect(()=>{
  let active=true;const revision=edits.current;
  void window.ccu.request({action:'table.widths',table:storageKey}).then(result=>{
   if(!active||edits.current!==revision||drag.current||!result.ok)return;
   const next=validWidths(result.data,columns);if(next){current.current=next;setWidths(next);}
  }).catch(()=>{});
  return()=>{active=false;};
 },[storageKey]);
 const save=(next:number[])=>{
  try{localStorage.setItem('ccu.table-widths.v2.'+storageKey,JSON.stringify(next));}catch{/* In-memory adjustments are still usable. */}
  void window.ccu.request({action:'table.widths',table:storageKey,widths:next}).catch(()=>{});
 };
 const change=(next:number[],persist=false)=>{edits.current++;current.current=next;setWidths(next);if(persist)save(next);};
 function contentWidth(column:number){
  const node=table.current,context=document.createElement('canvas').getContext('2d');if(!node||!context)return columns[column]!.preferred;
  let fitted=minimum[column]!;const occupied=columns.map(()=>0);
  const measure=(cell:HTMLElement,index:number)=>{if(index!==column)return;const style=getComputedStyle(cell);context.font=style.fontWeight+' '+style.fontSize+' '+style.fontFamily;
   const lines=cell.innerText.split('\n'),pad=parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+(index===0?20:0)+12;
   fitted=Math.max(fitted,Math.ceil(Math.max(0,...lines.map(text=>context.measureText(text).width))+pad));};
  [...node.tHead!.rows[0]!.cells].forEach((cell,i)=>measure(cell,i));
  [...node.tBodies[0]!.rows].forEach((row,r)=>{let index=0;for(const cell of row.cells){while(occupied[index]!>r)index++;if(index>=columns.length)break;if(cell.colSpan===1)measure(cell,index);for(let n=0;n<cell.colSpan;n++)occupied[index+n]=r+cell.rowSpan;index+=cell.colSpan;}});
  return Math.min(maxWidth,columns[column]!.autoLimit??maxWidth,fitted);
 }
 function finish(event:React.PointerEvent<HTMLSpanElement>){if(drag.current?.pointer!==event.pointerId)return;drag.current=null;save(current.current);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}
 return <div className="table-scroll"><table ref={table} className={className+' resizable-inventory'} aria-label={label} style={{width:effective.reduce((a,b)=>a+b,0),minWidth:0}}>
  <colgroup>{effective.map((width,i)=><col key={i} style={{width}}/>)}</colgroup><thead><tr>{columns.map((column,i)=><th key={i} title={column.label}><span className="inventory-column-label">{column.header??column.label}</span><span className="inventory-column-resizer" role="separator" tabIndex={0} aria-label={column.label+' · '+t('Spaltenbreite')} aria-orientation="vertical" aria-valuemin={minimum[i]} aria-valuemax={maxWidth} aria-valuenow={effective[i]} title={t('Ziehen: Spaltenbreite ändern. Doppelklick: Inhalt einpassen.')}
   onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();drag.current={pointer:event.pointerId,column:i,start:event.clientX,widths:[...effective]};event.currentTarget.setPointerCapture(event.pointerId);}}
   onPointerMove={event=>{const state=drag.current;if(!state||state.pointer!==event.pointerId)return;const next=[...state.widths];next[i]=Math.max(minimum[i]!,Math.min(maxWidth,Math.round(state.widths[i]!+event.clientX-state.start)));change(next);}}
   onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
   onDoubleClick={()=>{const next=[...effective];next[i]=contentWidth(i);change(next,true);}}
   onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=[...effective];next[i]=event.key==='Home'?minimum[i]!:event.key==='End'?maxWidth:Math.max(minimum[i]!,Math.min(maxWidth,effective[i]!+(event.key==='ArrowRight'?20:-20)));change(next,true);}}/>
  </th>)}</tr></thead>{children}
 </table></div>;
}
