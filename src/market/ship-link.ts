/** Only official, observed ship landing pages; never checkout, actions or invented slugs. */
export function safeRsiShipUrl(value:unknown):string|null{
  if(typeof value!=='string'||value.length>512||/[\\%\s]/.test(value))return null;
  try{
    if(!value.startsWith('/')&&!value.startsWith('https://robertsspaceindustries.com/'))return null;
    const url=new URL(value,'https://robertsspaceindustries.com');
    if(url.origin!=='https://robertsspaceindustries.com'||url.username||url.password||url.search||url.hash||
      !/^\/(?:en\/)?pledge\/ships\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))return null;
    // Reject normalization of dot segments rather than accepting a different observed path.
    if(value.split('/').some(part=>part==='.'||part==='..'))return null;
    return url.href;
  }catch{return null;}
}
