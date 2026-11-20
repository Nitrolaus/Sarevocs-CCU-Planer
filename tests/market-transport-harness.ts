import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { MarketService } from '../src/market/service';
import { publicMarketReader } from '../src/market/transport';
import { MARKET_SOURCES } from '../src/market/model';
import { PricingService } from '../src/pricing/service';

const folder = process.argv.find(a => a.startsWith('--probe-dir='))?.slice(12);
if (!folder || !path.isAbsolute(folder)) throw new Error('PROBE_DIRECTORY_REQUIRED');
for (const key of ['userData', 'sessionData', 'crashDumps', 'logs', 'temp'] as const) { const dir = path.join(folder, key); fs.mkdirSync(dir, { recursive: true }); app.setPath(key, dir); }
app.disableHardwareAcceleration();
const requests: { allowed: boolean; method: string; credentialsPresent: boolean }[] = [];
app.on('session-created', isolated => {
  isolated.webRequest.onBeforeSendHeaders((details, callback) => {
    const allowed = Object.values(MARKET_SOURCES).includes(details.url as typeof MARKET_SOURCES[keyof typeof MARKET_SOURCES]);
    const credentialsPresent = Object.keys(details.requestHeaders).some(key => /^(cookie|authorization|proxy-authorization|x-rsi-token)$/i.test(key));
    requests.push({ allowed, method: details.method, credentialsPresent }); callback({ cancel: !allowed || credentialsPresent });
  });
});
app.whenReady().then(async () => {
  const reader=publicMarketReader();
  const service = new MarketService(path.join(folder, 'public-cache'), reader);
  const pricing=new PricingService(path.join(folder,'pricing-cache'),signal=>reader('fx',signal));
  try {
    await Promise.all([service.refresh(),pricing.refresh()]); const result = service.snapshot();
    assert.equal(pricing.snapshot().rateError,false);assert.ok(pricing.snapshot().rate);
    assert.equal(result.errors.catalogue, null); assert.equal(result.errors.offers, null);
    assert.ok(result.catalogue!.ships.length > 0); assert.ok(result.offers!.items.length > 0);
    assert.equal(requests.length, 3); assert.ok(requests.every(r => r.allowed && r.method === 'GET' && !r.credentialsPresent));
    const report = { status: 'PASS', version: '0.3.20', realUserFilesRead: false, newRsiLogin: false, credentialHeadersPresent: false,
      requests, catalogueCount: result.catalogue!.ships.length, targetOfferCount: result.offers!.items.length,
      warbondTargetCount: result.offers!.items.filter(i => i.warbond).length, sourceAt: result.offers!.sourceAt, fetchedAt: result.offers!.fetchedAt,
      verifiedShipLinks:result.catalogue!.ships.filter(ship=>ship.storeUrl).length,ecbRate:pricing.snapshot().rate,
      proof: 'Actual dedicated Electron transport read three fixed public sources, normalized and cached them; no account, vault or renderer was loaded.' };
    fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    service.close();pricing.close(); app.quit();
  } catch { service.close();pricing.close(); fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', requests, error: 'PUBLIC_SOURCE_PROBE_FAILED' }, null, 2)); app.exit(1); }
});
