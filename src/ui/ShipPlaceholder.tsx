import React from 'react';
import { useText } from './i18n';

export function ShipPlaceholder({ index }: { index: number }) {
  const t = useText();
  return <div className={'market-art market-art-' + index} role="img" aria-label={t('Schematische Platzhaltergrafik, kein Originalbild')}>
    <span>{t('PLATZHALTERGRAFIK')}</span>
    <div className="market-ship" aria-hidden="true">
      <i className="wing left" /><i className="wing right" /><i className="engine left" /><i className="engine right" />
      <i className="hull" /><i className="cockpit" />
    </div>
  </div>;
}
