import { api } from '@electron-forge/core';
import path from 'node:path';
const paths = await api.package({ dir: process.cwd(), platform: 'win32', arch: 'x64',
  outDir: path.resolve('work/temp/packaged'), interactive: false });
console.log('Windows-Testbuild:', paths);
