import { app } from 'electron';
import { handleInstallerEvent } from './main/installer-events';
import { installerLockActive } from './main/installer-lock';
// Install/uninstall events must terminate before creating inventory, sessions, locks or windows.
void handleInstallerEvent(process.argv, process.execPath).then(handled => {
  if (handled || installerLockActive(process.execPath)) app.exit(0); else require('./main.cjs');
}).catch(() => app.exit(1));
