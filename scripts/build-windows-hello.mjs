import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function buildWindowsHello() {
  const root = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const vswhere = path.join(root, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const studio = execFileSync(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
  { encoding: 'utf8', windowsHide: true }).trim();
  if (!studio) throw new Error('Visual Studio C++ Build Tools mit Windows SDK erforderlich.');
  const vcRoot = path.join(studio, 'VC', 'Tools', 'MSVC');
  const kits = path.join(root, 'Windows Kits', '10');
  const versions = dir => fs.readdirSync(dir).filter(name => /^\d+(?:\.\d+)+$/.test(name))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  const compilerPath = path.join('bin', 'Hostx64', 'x64', 'cl.exe');
  const vcVersion = versions(vcRoot).find(name => fs.existsSync(path.join(vcRoot, name, compilerPath)));
  const sdkVersion = versions(path.join(kits, 'Include')).find(name =>
    fs.existsSync(path.join(kits, 'Include', name, 'cppwinrt', 'winrt', 'Windows.Security.Credentials.UI.h')) &&
    fs.existsSync(path.join(kits, 'Include', name, 'um', 'userconsentverifierinterop.h')) &&
    fs.existsSync(path.join(kits, 'Lib', name, 'um', 'x64', 'runtimeobject.lib')));
  if (!vcVersion || !sdkVersion) throw new Error('C++-Compiler oder Windows-11-SDK nicht vollständig installiert.');
  const vc = path.join(vcRoot, vcVersion);
  const includes = [path.join(vc, 'include'), ...['shared', 'ucrt', 'um', 'winrt', 'cppwinrt']
    .map(folder => path.join(kits, 'Include', sdkVersion, folder))];
  const libraries = [path.join(vc, 'lib', 'x64'), ...['um', 'ucrt'].map(folder => path.join(kits, 'Lib', sdkVersion, folder, 'x64'))];
  execFileSync(path.join(vc, compilerPath), [
    '/nologo', '/std:c++20', '/EHsc', '/O2', '/MT', '/Fe:build/hello-consent.exe', '/Fo:work/temp/hello-consent.obj',
    ...includes.map(value => '/I' + value), 'native/hello-consent.cpp', 'runtimeobject.lib', 'user32.lib', 'ole32.lib', 'oleaut32.lib',
    '/link', ...libraries.map(value => '/LIBPATH:' + value),
  ], { stdio: 'inherit', windowsHide: true });
}
