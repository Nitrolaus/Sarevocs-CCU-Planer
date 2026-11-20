import React from 'react';import type {StoreCredit} from '../domain/store-credit';import {formatMinor} from '../pricing/money';import {useText} from './i18n';
export function StoreCreditBadge({credit,language}:{credit?:StoreCredit;language:'de'|'en'}){
 const t=useText(),stand=credit?new Intl.DateTimeFormat(language==='de'?'de-DE':'en-GB',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Berlin'}).format(new Date(credit.observedAt)):null;
 return <div className="store-credit" aria-label={t('Store-Credit-Guthaben')} title={stand?t('Zuletzt von RSI gelesen')+': '+stand+' · '+t('Guthaben in RSI-Währung, keine Steuerberechnung.'):t('Noch kein Store-Credit-Guthaben gelesen.')}><small>Store Credits · RSI</small><strong>{credit?formatMinor(credit.minor,credit.currency,language):t('Nicht gelesen')}</strong></div>;
}
