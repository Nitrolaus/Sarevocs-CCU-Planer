import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productIdentity} from '../installer/msi/product-identity.mjs';

test('rebuilding one release retains its maintenance identity',()=>{
  assert.deepEqual(productIdentity('0.3.130'),productIdentity('0.3.130'));
  assert.match(productIdentity('0.3.130').productCode,/^\{[A-F0-9]{8}-[A-F0-9]{4}-5[A-F0-9]{3}-8[A-F0-9]{3}-[A-F0-9]{12}\}$/);
});
test('each release gets its own major-upgrade identity',()=>{
  const codes=['0.3.130','0.3.131','0.4.0','1.0.0'].map(v=>productIdentity(v).productCode);
  assert.equal(new Set(codes).size,codes.length);
  assert(!codes.includes('{142B7731-1211-4ED2-AE86-C572D7053121}'));
});
test('malformed and MSI-ambiguous release versions are rejected',()=>{
  for(const invalid of ['0.3','0.3.130.1','0.3.130-alpha','00.3.130','256.0.0','0.256.0','0.3.65536','1.0.0\n',null,130])assert.throws(()=>productIdentity(invalid));
});
