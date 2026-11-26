import {createHash} from 'node:crypto';

export function productIdentity(version) {
  if(typeof version!=='string'||version!==version.trim()||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Expected a three-part MSI version');
  const [major,minor,build]=version.split('.').map(Number);
  if(major>255||minor>255||build>65535)throw Error('Version exceeds Windows Installer limits');
  const h=createHash('sha256').update('SarevocsCCUPlanerMSI|product|'+version).digest('hex');
  return {version,productCode:`{${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}}`.toUpperCase()};
}
