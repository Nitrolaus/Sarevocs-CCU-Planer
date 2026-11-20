import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { euroRateSchema, parseEcbRate, type EuroRate } from './money';
import { DailyRefresh, type RefreshClock } from '../scheduling/daily-refresh';
import { displaySettingsSchema, DEFAULT_DISPLAY_SETTINGS, type DisplaySettings, type PricingSnapshot } from './model';
export { displaySettingsSchema, DEFAULT_DISPLAY_SETTINGS, type DisplaySettings, type PricingSnapshot } from './model';
type RateReader = (signal:AbortSignal)=>Promise<unknown>;
export class PricingService {
  private settings:DisplaySettings={...DEFAULT_DISPLAY_SETTINGS};private configured=false;private settingsError=false;
  private rate:EuroRate|null=null;private rateError=false;private closed=false;
  private inFlight:Promise<void>|null=null;private controller:AbortController|null=null;private readonly schedule:DailyRefresh;
  constructor(readonly directory:string,private readonly readRate:RateReader,clock?:RefreshClock){
    this.schedule=new DailyRefresh(()=>this.refresh(),clock);
    try{this.settings=displaySettingsSchema.parse(this.load('display-v1.json'));this.configured=true;}
    catch(error){this.settingsError=!this.absent(error);}
    try{this.rate=euroRateSchema.parse(this.load('ecb-v1.json'));}
    catch(error){this.rateError=!this.absent(error);}
  }
  private absent(error:unknown):boolean{return !!error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT';}
  private load(name:string):unknown{
    const file=path.join(this.directory,name),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65_536||stat.size<2)throw Error('PRICING_FILE');
    return JSON.parse(fs.readFileSync(file,'utf8'));
  }
  private write(name:string,value:unknown):void{
    fs.mkdirSync(this.directory,{recursive:true});const file=path.join(this.directory,name),temp=file+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,JSON.stringify(value),{flag:'wx'});fs.renameSync(temp,file);}
    finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  snapshot():PricingSnapshot{return structuredClone({settings:this.settings,configured:this.configured,settingsError:this.settingsError,rate:this.rate,pending:!!this.inFlight,rateError:this.rateError});}
  save(value:unknown):DisplaySettings{
    if(this.closed)throw Error('PRICING_CLOSED');
    const settings=displaySettingsSchema.parse(value);this.write('display-v1.json',settings);
    this.settings=settings;this.configured=true;this.settingsError=false;return structuredClone(settings);
  }
  start():void{if(!this.closed)this.schedule.start();}
  refresh():Promise<void>{
    if(this.closed)return Promise.resolve();if(this.inFlight)return this.inFlight;
    const controller=this.controller=new AbortController();
    const run=async()=>{try{
      const xml=await this.readRate(controller.signal);if(this.closed||controller.signal.aborted)return;
      const rate=parseEcbRate(xml);if(this.rate&&rate.sourceDate<this.rate.sourceDate)throw Error('ECB_OLDER');
      this.write('ecb-v1.json',rate);this.rate=rate;this.rateError=false;
    }catch{if(!this.closed)this.rateError=true;}};
    this.inFlight=run().finally(()=>{this.inFlight=null;this.controller=null;});return this.inFlight;
  }
  close():void{this.closed=true;this.schedule.close();this.controller?.abort();}
}
