import {net,session} from 'electron';import {randomUUID} from 'node:crypto';
import {PAINT_GROUP_QUERY,PAINT_PAGE_QUERY,PAINT_RULE_QUERY,type PaintTransport} from './source';
/** Anonymous, nonpersistent public transport. It cannot share the user's RSI session. */
export function publicPaintReader():PaintTransport {
 const isolated=session.fromPartition('public-paints-'+randomUUID());isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));isolated.setPermissionCheckHandler(()=>false);
 return (query,variables,signal)=>new Promise((resolve,reject)=>{
  const operationName=query===PAINT_GROUP_QUERY?'SarevocPaintGroups':query===PAINT_PAGE_QUERY?'SarevocPaintPage':query===PAINT_RULE_QUERY?'SarevocPaintRules':null;
  if(!operationName||signal.aborted){reject(Error('PAINT_QUERY_REFUSED'));return;}
  const request=net.request({method:'POST',url:'https://robertsspaceindustries.com/graphql',session:isolated,credentials:'omit',useSessionCookies:false,redirect:'error'});
  const chunks:Buffer[]=[];let bytes=0,settled=false;
  const finish=(error?:Error,value?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(error){request.abort();reject(error);}else resolve(value);};
  const abort=()=>finish(Error('PAINT_SOURCE_CANCELLED')),timer=setTimeout(()=>finish(Error('PAINT_SOURCE_TIMEOUT')),20000);signal.addEventListener('abort',abort,{once:true});
  request.setHeader('Accept','application/json');request.setHeader('Content-Type','application/json');
  request.on('login',()=>finish(Error('PAINT_AUTH_REFUSED')));request.on('redirect',()=>finish(Error('PAINT_REDIRECT_REFUSED')));request.on('error',()=>finish(Error('PAINT_NETWORK_ERROR')));
  request.on('response',response=>{if(response.statusCode!==200||!/^application\/json(?:;|$)/i.test(String(response.headers['content-type']??''))){finish(Error('PAINT_RESPONSE_INVALID'));return;}
   response.on('error',()=>finish(Error('PAINT_NETWORK_ERROR')));response.on('data',chunk=>{const buffer=Buffer.from(chunk);bytes+=buffer.length;if(bytes>8*1024*1024)finish(Error('PAINT_RESPONSE_SIZE'));else if(!settled)chunks.push(buffer);});
   response.on('end',()=>{if(settled)return;try{finish(undefined,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(Error('PAINT_JSON_INVALID'));}});
  });request.end(JSON.stringify({operationName,query,variables}));
 });
}
