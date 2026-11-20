import {BrowserWindow} from 'electron';
import {randomUUID} from 'node:crypto';
import type {ReportDocument} from './model';
import {reportHtml} from './render';
import {UserError} from '../domain/model';
const windows=new Set<BrowserWindow>();
export function closeReportWindows(){for(const win of windows)if(!win.isDestroyed())win.destroy();windows.clear();}
/** A new non-persistent session, no preload, no network, no RSI partition, never shown. */
export async function pdfReport(document:ReportDocument):Promise<Buffer>{
 if((document.sections??[document]).reduce((sum,section)=>sum+section.rows.length,0)>5000)throw new UserError('PDF ist auf 5.000 Zeilen begrenzt. Für größere Bestände bitte Excel wählen.');
 const html=reportHtml(document);if(Buffer.byteLength(html)>24*1024*1024)throw new UserError('PDF-Inhalt ist zu groß. Bitte Excel wählen.');
 const win=new BrowserWindow({show:false,width:1123,height:794,webPreferences:{partition:'ccu-report-'+randomUUID(),sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true,javascript:false,backgroundThrottling:false}});windows.add(win);
 const session=win.webContents.session;
 session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));session.setPermissionCheckHandler(()=>false);
 session.on('will-download',event=>event.preventDefault());
 session.webRequest.onBeforeRequest((details,cb)=>cb({cancel:!details.url.startsWith('data:text/html;charset=utf-8,')}));
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const operation=(async()=>{await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));return win.webContents.printToPDF({landscape:true,printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;width:100%;text-align:center;color:#53616c">Sarevoc´s CCU Planer · <span class="pageNumber"></span> / <span class="totalPages"></span></div>'});})();
  const bytes=await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new UserError('PDF-Erstellung dauerte zu lange. Bitte Excel wählen.')),60_000);})]);
  if(bytes.length>64*1024*1024)throw new UserError('PDF ist zu groß. Bitte Excel wählen.');return bytes;
 }finally{clearTimeout(timer);windows.delete(win);if(!win.isDestroyed())win.destroy();}
}
