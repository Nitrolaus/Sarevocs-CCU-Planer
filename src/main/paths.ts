import path from 'node:path';
export function runtimePaths(options: { packaged: boolean; cwd: string; localAppData: string | undefined; override?: string }) {
  if (options.override && !path.isAbsolute(options.override)) throw new Error('Ein absoluter Datenordner ist erforderlich.');
  if (options.packaged && !options.override && (!options.localAppData || !path.isAbsolute(options.localAppData))) throw new Error('Windows-Benutzerdatenordner nicht verfügbar.');
  // Squirrel may replace its whole installation root. User data must be a sibling, never inside it.
  const root = path.resolve(options.override ?? (options.packaged ? path.join(options.localAppData!, 'SarevocsCCUPlaner-Daten') : path.join(options.cwd, 'work/runtime')));
  return { root, inventory: path.join(root, 'Daten'), vault: path.join(root, 'Anmeldung'),
    electron: path.join(root, 'Laufzeit'), session: path.join(root, 'FluechtigeSitzungen'), crashes: path.join(root, 'Diagnose') };
}
