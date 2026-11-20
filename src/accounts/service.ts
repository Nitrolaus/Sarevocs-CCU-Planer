import { UserError, type Account, type ImportCandidate } from '../domain/model';
export function checkBinding(account: Account, candidate: ImportCandidate, manuallyConfirmed: boolean) {
  if (account.mode !== candidate.document.dataMode) throw new UserError('Demo- und Echtdaten dürfen nicht in dasselbe Profil.');
  const incoming = candidate.document.account;
  if (account.reference !== null && (account.reference !== incoming.reference || account.identityKind !== incoming.identityKind)) {
    throw new UserError('Die Datei gehört zu einer anderen Kontoreferenz. Ein getrenntes Profil verwenden.');
  }
  if ((account.reference === null || incoming.identityKind === 'manual-reference') && !manuallyConfirmed) throw new UserError('Kontozuordnung muss ausdrücklich bestätigt werden.');
}
