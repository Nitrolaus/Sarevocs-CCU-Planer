import { app, Menu, Tray, type BrowserWindow } from 'electron';

/** Desktop-only controls; session saving remains in the application's quit guard. */
export class DesktopLifecycle {
  private window: BrowserWindow | null = null;
  private windowReady = false;
  private tray: Tray | null = null;

  constructor(private readonly options: {
    name: string;
    icon: string;
    closeToTray?: () => boolean;
    isQuitting: () => boolean;
    shutdownComplete: () => boolean;
  }) {
    // The arguments of a second process are deliberately neither used nor logged.
    app.on('second-instance', () => this.show());
    app.on('activate', () => this.show());
  }

  initialize() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Datei', submenu: [
      { id: 'app.open', label: 'Öffnen', click: () => this.show() },
      { id: 'app.quit', label: 'Beenden', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
    ] }]));
    if (this.tray && !this.tray.isDestroyed()) return;
    let tray: Tray | null = null;
    try {
      tray = new Tray(this.options.icon);
      tray.setToolTip(this.options.name);
      tray.setContextMenu(Menu.buildFromTemplate([
        { id: 'tray.open', label: 'Öffnen', click: () => this.show() },
        { id: 'tray.quit', label: 'Beenden', click: () => app.quit() },
      ]));
      tray.on('click', () => this.show());
      tray.on('double-click', () => this.show());
      this.tray = tray;
    } catch {
      // Without a usable icon, X must remain a way to exit the application.
      tray?.destroy();
      this.tray = null;
    }
  }

  attachWindow(window: BrowserWindow) {
    this.window = window;
    this.windowReady = false;
    window.on('close', event => {
      if (this.options.isQuitting()) {
        if (!this.options.shutdownComplete()) event.preventDefault();
        return;
      }
      event.preventDefault();
      if (this.options.closeToTray?.() !== false && this.tray && !this.tray.isDestroyed()) window.hide();
      else app.quit();
    });
    window.on('closed', () => {
      this.window = null;
      if (!this.options.isQuitting()) app.quit();
    });
    // Windows does not emit before-quit for system logout/shutdown on its own.
    // Delay the query while the same guarded application shutdown saves sessions.
    window.on('query-session-end', event => {
      if (this.options.shutdownComplete()) return;
      event.preventDefault();
      app.quit();
    });
    window.on('session-end', () => app.quit());
  }

  ready() {
    this.windowReady = true;
    this.show();
  }

  show() {
    const window = this.window;
    // Startup always reveals the one window once it has finished loading, so an
    // activation received during vault/database startup cannot be lost.
    if (this.options.isQuitting() || !this.windowReady || !window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  destroy() {
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy();
    this.tray = null;
  }
}
