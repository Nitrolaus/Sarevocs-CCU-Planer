import {addonCategories} from '../domain/inventory-addons';

const insurance = [
 ['lti','LTI','LTI'], ['months','Befristet versichert','Time-limited insurance'], ['unknown','Versicherung offen','Insurance unknown'],
] as const;

export const reportFilterOptions = {
 ships: insurance,
 ccus: [
  ['unused','Ungenutzt','Unused'], ['applied','Angewendet','Applied'], ['unverified','Status offen','Status unknown'],
 ],
 addons: addonCategories,
 paints: [
  ['meltable','Einschmelzbar laut RSI','Reclaimable according to RSI'], ['ship-package','Im Schiffspaket','In a ship package'],
  ['mixed-contents','In sonstigem Paket','In another package'], ['not-meltable','Nicht einschmelzbar laut RSI','Non-reclaimable according to RSI'],
  ['unknown','Einschmelzstatus offen','Reclaim status unknown'],
 ],
 packages: [
  ['sc','Nur mit Star Citizen','Star Citizen only'], ['sq42','Nur mit Squadron 42','Squadron 42 only'], ['both','Mit beiden Spielen','Both games'],
 ],
 access: [['sc','Star Citizen','Star Citizen'], ['sq42','Squadron 42','Squadron 42']],
 buyback: insurance,
 loaners: [['loaner','Loaner','Loaners'], ['included','Beiboote','Snub ships']],
 chain: [
  ['owned','Vorhandene CCUs','Owned CCUs'], ['purchase','Noch zu kaufen','Still to buy'], ['warning','Anschluss offen','Connection unresolved'],
 ],
 offers: [['warbond','Mit Warbond','With Warbond'], ['standard','Ohne Warbond','Without Warbond']],
} as const;

export function reportFilterLabels(kind: keyof typeof reportFilterOptions, selected: readonly string[], language: 'de'|'en'): string[] {
 return reportFilterOptions[kind].filter(([id])=>selected.includes(id)).map(option=>option[language==='en'?2:1]);
}
