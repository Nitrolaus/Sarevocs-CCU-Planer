const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const version = require('./package.json').version;
module.exports = {
  packagerConfig: {
    name: 'Sarevocs-CCU-Planer', executableName: 'Sarevocs-CCU-Planer',
    appCopyright: 'Sarevoc', asar: { unpack: '**/hello-consent.exe' },
    icon: require('node:path').join(__dirname, 'assets/app.ico'),
    win32metadata: { CompanyName: 'Sarevoc', FileDescription: 'Sarevoc´s CCU Planer', ProductName: 'Sarevoc´s CCU Planer', 'requested-execution-level': 'asInvoker' },
    ignore: [/^\/(?!build(?:\/|$)|node_modules(?:\/|$)|package\.json$)/],
  },
  rebuildConfig: {},
  makers: [{ name: '@electron-forge/maker-squirrel', config: {
    name: 'SarevocsCCUPlaner', title: 'Sarevoc´s CCU Planer', authors: 'Sarevoc',
    description: 'Lokaler CCU-Planer für Windows 11 – interne Entwicklungsversion',
    exe: 'Sarevocs-CCU-Planer.exe', setupExe: `Sarevocs-CCU-Planer-Setup-${version}.exe`,
    noMsi: true, noDelta: true,
    setupIcon: require('node:path').join(__dirname, 'assets/app.ico'),
    nuspecTemplate: require('node:path').join(__dirname, 'installer/app.nuspectemplate'),
  } }],
  plugins: [new FusesPlugin({ version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  })],
};
