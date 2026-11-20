import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { GiveawayOriginsStore } from '../src/storage/giveaway-origins';
import { commandSchema } from '../src/main/commands';
import { giveawayShip } from '../src/domain/giveaway';
import { basePledge } from './fixtures';

const dir = () => path.resolve('work/temp/giveaway-tests', randomUUID());

test('Giveaway editing requires an explicitly marked ship and skips loaners', () => {
  const pledge = basePledge();
  assert.equal(giveawayShip(pledge), undefined);
  const giveaway = { ...pledge, name:'Synthetic ship — GIVEAWAY' };
  const ship = giveaway.ships[0]!;
  const loaner = { ...ship, childId:'loaner', role:'loaner' as const };
  assert.equal(giveawayShip({ ...giveaway, ships:[] }), undefined);
  assert.equal(giveawayShip({ ...giveaway, ships:[loaner] }), undefined);
  assert.equal(giveawayShip({ ...giveaway, ships:[loaner, ship] }), ship);
});

test('A donor name persists for one pledge in one profile and clearing leaves other notes intact', () => {
  const directory = dir(), a = randomUUID(), b = randomUUID();
  const store = new GiveawayOriginsStore(directory);
  assert.deepEqual(store.snapshot(a), { accountId:a, entries:[] });
  store.save(a, { pledgeId:'123', organizer:'  Synthetic donor  ' });
  store.save(a, { pledgeId:'124', organizer:'Another donor' });
  store.save(b, { pledgeId:'123', organizer:'Different profile' });
  const restarted = new GiveawayOriginsStore(directory);
  assert.deepEqual(restarted.snapshot(a).entries[0], { pledgeId:'123', organizer:'Synthetic donor' });
  assert.deepEqual(restarted.snapshot(b).entries[0], { pledgeId:'123', organizer:'Different profile' });
  assert.deepEqual(restarted.save(a, { pledgeId:'123', organizer:'' }).entries, [{ pledgeId:'124', organizer:'Another donor' }]);
  assert.deepEqual(new GiveawayOriginsStore(directory).snapshot(a).entries, [{ pledgeId:'124', organizer:'Another donor' }]);
});

test('A mismatched profile file remains intact and the command accepts only a bounded donor name', () => {
  const directory = dir(), accountId = randomUUID(), store = new GiveawayOriginsStore(directory);
  fs.mkdirSync(directory, { recursive:true });
  const file = path.join(directory, accountId + '.json');
  const contents = JSON.stringify({ schemaVersion:1, accountId:randomUUID(), entries:[] });
  fs.writeFileSync(file, contents);
  assert.throws(() => store.save(accountId, { pledgeId:'123', organizer:'Synthetic donor' }));
  assert.equal(fs.readFileSync(file,'utf8'), contents);
  const command = { action:'inventory.giveaways', accountId, edit:{ pledgeId:'123', organizer:'Synthetic donor' } };
  assert.ok(commandSchema.safeParse(command).success);
  for (const organizer of ['x'.repeat(81), 'line\nbreak', '\u202eHidden'])
    assert.equal(commandSchema.safeParse({ ...command, edit:{ ...command.edit, organizer } }).success,false);
  assert.equal(commandSchema.safeParse({ ...command, edit:{ ...command.edit, url:'https://example.invalid' } }).success,false);
});
