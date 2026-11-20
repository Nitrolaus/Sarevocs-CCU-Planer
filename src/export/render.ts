import type {ReportCell,ReportDocument,ReportPreview} from './model';
export function cellText(value:ReportCell,format:ReportDocument['columns'][number]['format'],language:'de'|'en'):string{
 if(value===null)return language==='de'?'Offen':'Unknown';
 if(value instanceof Date)return new Intl.DateTimeFormat(language==='de'?'de-DE':'en-US',{dateStyle:'short',timeZone:'UTC'}).format(value);
 return typeof value==='number'?new Intl.NumberFormat(language==='de'?'de-DE':'en-US',{minimumFractionDigits:format==='money'?2:0,maximumFractionDigits:format==='money'?2:0}).format(value):value;
}
export function reportPreview(document:ReportDocument,token:string):ReportPreview{
 return {token,title:document.title,profileName:document.profileName,createdAt:document.createdAt,count:document.rows.length,
  columns:document.columns.map(c=>c.label),rows:document.rows.slice(0,2).map(r=>r.cells.map((c,i)=>cellText(c,document.columns[i]?.format,document.language))),tones:document.rows.slice(0,2).map(r=>r.tone),notes:[...document.notes],totals:structuredClone(document.totals),
  ...(document.sections?{sections:document.sections.map(section=>({kind:section.kind,title:section.title,count:section.rows.length}))}:{})};
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function reportHtml(d:ReportDocument):string{
 return `<!doctype html><html lang="${d.language}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><title>${escape(d.title)}</title><style>
 @page{size:A4 landscape;margin:12mm 10mm 15mm}*{box-sizing:border-box}body{font:9pt Arial,sans-serif;color:#14232b;margin:0}h1{font-size:19pt;margin:0 0 3mm}p{margin:1mm 0;line-height:1.35;overflow-wrap:anywhere}header{margin-bottom:4mm}.meta{color:#42515b;font-size:8pt}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th{background:#163b42;color:white;text-align:left}th,td{padding:2mm 1.4mm;border:0.2mm solid #b6c8cc;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}td.number{text-align:right;font-variant-numeric:tabular-nums}.owned td:first-child{border-left:1mm solid #00a69e}.purchase td:first-child{border-left:1mm solid #e79731}.warning td:first-child{border-left:1mm solid #b44343}tbody tr:nth-child(even){background:#f2f6f7}.totals{margin:4mm 0;break-inside:avoid}.totals p{font-weight:bold}
 section+section{break-before:page}
 </style></head><body>${(d.sections??[d]).map(reportSectionHtml).join('')}</body></html>`;
}
function reportSectionHtml(d:ReportDocument):string{
 const meta=[new Date(d.createdAt).toISOString(),...d.notes];
 return `<section><header><h1>${escape(d.title)}</h1><p>${escape(d.profileName)} · Sarevoc´s CCU Planer</p>${meta.map(s=>`<p class="meta">${escape(s)}</p>`).join('')}</header><table><colgroup>${d.columns.map(c=>`<col style="width:${c.width/d.columns.reduce((s,c)=>s+c.width,0)*100}%">`).join('')}</colgroup><thead><tr>${d.columns.map(c=>`<th>${escape(c.label)}</th>`).join('')}</tr></thead><tbody>${d.rows.map(r=>`<tr class="${r.tone??''}">${r.cells.map((v,i)=>`<td${typeof v==='number'?' class="number"':''}>${escape(cellText(v,d.columns[i]?.format,d.language))}</td>`).join('')}</tr>`).join('')}</tbody></table><div class="totals">${d.totals.map(t=>`<p>${escape(t.label)}: ${escape(t.value)}</p>`).join('')}</div></section>`;
}
