import ExcelJS from 'exceljs';
import {UserError} from '../domain/model';
import type {ReportDocument} from './model';
/** Only typed values, never formulas, links, macros or user-supplied workbook metadata. */
export async function excelReport(document:ReportDocument):Promise<Buffer>{
 const book=new ExcelJS.Workbook();book.creator='Sarevoc';book.created=new Date(document.createdAt);book.modified=new Date(document.createdAt);
 const names={inventory:'Bestand',ships:'Schiffe & Fahrzeuge',ccus:'CCUs im Bestand',paints:'Paints',packages:'Spielpakete',access:'Spielzugänge',
  buyback:'Buy Back',loaners:'Loaner & Beiboote',chain:'CCU-Kette',offers:'Angebote'} as const;
 for(const section of document.sections??[document])addReportSheet(book,section,names[section.kind]);
 const buffer=Buffer.from(await book.xlsx.writeBuffer());if(buffer.length>64*1024*1024)throw new UserError('Excel-Export ist zu groß.');return buffer;
}
function addReportSheet(book:ExcelJS.Workbook,d:ReportDocument,name:string){
 const sheet=book.addWorksheet(name);
 sheet.columns=d.columns.map(c=>({width:Math.min(50,Math.max(8,c.width))}));
 const end=d.columns.length;
 const line=(text:string,size=10,bold=false)=>{const row=sheet.addRow([text]);sheet.mergeCells(row.number,1,row.number,end);row.font={name:'Calibri',size,bold,color:{argb:'FF213D45'}};row.alignment={wrapText:true,vertical:'middle'};row.height=Math.max(20,Math.ceil(text.length/(end*12))*14);return row;};
 line(d.title,18,true);line(`${d.profileName} · Sarevoc´s CCU Planer`);line(new Date(d.createdAt).toISOString());
 for(const n of d.notes)line(n);
 for(const t of d.totals)line(`${t.label}: ${t.value}`,11,true);
 sheet.addRow([]);const header=sheet.addRow(d.columns.map(c=>c.label));header.height=34;
 header.eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17434A'}};cell.font={name:'Calibri',size:10,bold:true,color:{argb:'FFFFFFFF'}};cell.alignment={wrapText:true,vertical:'middle'};});
 for(const r of d.rows){
  const row=sheet.addRow(r.cells.map(c=>c===null?(d.language==='de'?'Offen':'Unknown'):c));
  // row values that begin with =,+,-,@ remain Excel shared strings, never formulas.
  row.font={name:'Calibri',size:10,color:{argb:'FF172C32'}};row.alignment={wrapText:true,vertical:'top'};
  let lines=1;row.eachCell((cell,index)=>{const column=d.columns[index-1]!;if(cell.type===ExcelJS.ValueType.Number&&column.format==='money')cell.numFmt='#,##0.00';if(cell.type===ExcelJS.ValueType.Date)cell.numFmt='dd.mm.yyyy';
   const text=String(cell.value??'');lines=Math.max(lines,...text.split('\n').map(t=>Math.ceil(t.length/Math.max(6,column.width-2))));
   if(r.tone)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:r.tone==='owned'?'FFE0F4F1':r.tone==='purchase'?'FFFFEBD2':'FFF9E3E3'}};
  });row.height=Math.max(26,lines*15);
 }
 sheet.views=[{state:'frozen',ySplit:header.number,xSplit:1}];sheet.autoFilter={from:{row:header.number,column:1},to:{row:header.number+d.rows.length,column:end}};
 sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:`${header.number}:${header.number}`};
}
