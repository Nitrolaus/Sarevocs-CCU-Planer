import React, { useEffect, useRef, useState } from 'react';
import { formatMinor } from '../pricing/money';
import { packageKey, packageSharesSchema, samePackageBasis, type PackageBasis, type PackageShare } from '../planner/package-shares';
import type { DisplaySettings } from '../pricing/model';
import { useText } from './i18n';

export function usePackageShares(accountId: string | null) {
  const [state, setState] = useState<{ accountId: string; shares: PackageShare[] }>();
  const [readError, setReadError] = useState(false);
  const scope = useRef(accountId);
  scope.current = accountId;
  useEffect(() => {
    let active = true;
    setState(undefined);
    setReadError(false);
    if (accountId) void window.ccu.request({ action:'planner.packageShares', accountId }).then(reply => {
      if (!reply.ok) throw Error(reply.error);
      const shares = packageSharesSchema.parse(reply.data);
      if (active) setState({ accountId, shares });
    }).catch(() => { if (active) setReadError(true); });
    return () => { active = false; };
  }, [accountId]);
  const shares = accountId && state?.accountId === accountId ? state.shares : undefined;
  async function save(basis: PackageBasis, minor: number | null) {
    if (!accountId || !shares) throw Error('PACKAGE_SHARES_NOT_READY');
    const reply = await window.ccu.request({ action:'planner.packageShares', accountId, edit:{ ...basis, minor } });
    if (!reply.ok) throw Error(reply.error);
    const updated = packageSharesSchema.parse(reply.data);
    if (scope.current === accountId) setState({ accountId, shares:updated });
  }
  return { shares, readError, save };
}

export function PackageShareDetails({ basis, settings, editor }: {
  basis: PackageBasis;
  settings: DisplaySettings;
  editor: ReturnType<typeof usePackageShares>;
}) {
  const t = useText();
  const stored = editor.shares?.find(share => samePackageBasis(share, basis));
  const [input, setInput] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const currency = (minor: number) => formatMinor(minor, basis.currency, settings.language);
  const maximum = basis.totalMinor - (editor.shares ?? []).filter(share =>
    packageKey(share) === packageKey(basis) && share.childId !== basis.childId
  ).reduce((total, share) => total + share.minor, 0);
  const value = input ?? (stored ? (stored.minor / 100).toFixed(2).replace('.', settings.language === 'de' ? ',' : '.') : '');
  async function save(minor: number | null) {
    setSaving(true);
    setError('');
    try {
      await editor.save(basis, minor);
      setInput(undefined);
    } catch {
      setError('Paketanteil konnte nicht gespeichert werden. Prüfe den Kaufpreis und die vergebenen Anteile.');
    } finally {
      setSaving(false);
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = value.trim();
    const minor = /^\d{1,7}(?:[.,]\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized.replace(',', '.')) * 100) : -1;
    if (minor < 0 || minor > maximum) {
      setError(t('Gib einen Betrag zwischen 0 und {maximum} ein.').replace('{maximum}', () => currency(maximum)));
      return;
    }
    void save(minor);
  }
  return <details className="ccu-package-share">
    <summary>{t('Paketdetails')} · {currency(basis.totalMinor)}</summary>
    <p>{t('Paketpreis laut RSI')} · {currency(basis.totalMinor)}</p>
    {editor.readError && <p role="alert">{t('Paketanteile konnten nicht geladen werden.')}</p>}
    <form onSubmit={submit}>
      <label>{t('Anteil für {ship}').replace('{ship}', () => basis.modelName)} · {basis.currency}
        <input inputMode="decimal" maxLength={10} value={value} disabled={!editor.shares || saving}
          onChange={event => { setInput(event.target.value); setError(''); }}/>
      </label>
      <button type="submit" disabled={!editor.shares || saving || !value.trim()}>{t('Speichern')}</button>
      {stored && <button type="button" disabled={saving} onClick={() => void save(null)}>{t('Anteil löschen')}</button>}
    </form>
    {stored && <p>{t('Eigene Angabe')} · {currency(stored.minor)}</p>}
    {settings.taxMode !== 'gross' && <p>{t('Der Paketanteil fließt in die Bruttoansicht ein.')}</p>}
    {error && <p role="alert">{t(error)}</p>}
  </details>;
}
