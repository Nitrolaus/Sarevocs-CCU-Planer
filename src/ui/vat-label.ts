export function vatLabel(basisPoints:number,language:'de'|'en'):string{
  const percent=new Intl.NumberFormat(language==='de'?'de-DE':'en-US',{maximumFractionDigits:2}).format(basisPoints/100);
  return language==='de'?`inkl. ${percent} % MwSt.`:`incl. ${percent} % VAT`;
}
