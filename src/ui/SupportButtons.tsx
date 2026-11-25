import React, { useState } from 'react';
import { STAR_CITIZEN_REFERRAL_CODE } from '../domain/referral';
import { useText } from './i18n';

export function SupportButtons() {
  const t = useText();
  const [failed, setFailed] = useState(false);
  const kofiLabel = t('Sarevoc auf Ko-fi unterstützen');
  const paypalLabel = t('Sarevoc über PayPal unterstützen');

  async function open(resource: 'kofi' | 'paypal' | 'referral') {
    setFailed(false);
    try {
      const result = await window.ccu.request({ action: 'help.openResource', resource });
      setFailed(!result.ok);
    } catch { setFailed(true); }
  }

  return <>
    <button type="button" className="sidebar-referral" onClick={() => void open('referral')}>
      <span>{t('Star-Citizen-Referral-Code')}</span>
      <strong>{STAR_CITIZEN_REFERRAL_CODE}</strong>
    </button>
    <div className="sidebar-support" role="group" aria-label={t('Projekt unterstützen')}>
      <button type="button" aria-label={kofiLabel} title={kofiLabel} onClick={() => void open('kofi')}>
        <img src="kofi-logo.png" alt="" width="68" height="20" />
        <span className="sidebar-support-text">Ko-fi</span>
      </button>
      <button type="button" aria-label={paypalLabel} title={paypalLabel} onClick={() => void open('paypal')}>PayPal</button>
    </div>
    {failed && <p className="sidebar-support-error" role="alert">{t('Der Unterstützungslink konnte nicht geöffnet werden.')}</p>}
  </>;
}
