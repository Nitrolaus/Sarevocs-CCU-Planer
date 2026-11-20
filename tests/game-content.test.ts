import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameContentKind } from '../src/domain/game-content';
import { basePledge } from './fixtures';

test('Game packages and shipless game copies use contents and ships, never titles, price or local protection', () => {
  const p = basePledge();
  p.name = 'Game Access - misleading name';
  p.sourceValues.alsoContains = JSON.stringify([{title:'Star Citizen Digital Download'}]);
  assert.equal(gameContentKind(p), 'package');
  p.name = 'Game Package - misleading name'; p.ships = [];
  assert.equal(gameContentKind(p), 'copy');
  p.protected = false; p.baseReleased = true;
  assert.equal(gameContentKind(p), 'copy');
  assert.equal('rsiProtected' in p, false);
  p.sourceValues = {}; assert.equal(gameContentKind(p), null);
});

test('Unreadable upgrades or CCUs never become game packages because of extra contents', () => {
  const p = basePledge();
  p.sourceValues.items = JSON.stringify([{title:'Squadron 42 Digital Download'}]);
  p.sourceValues.upgradeState = 'unresolved'; assert.equal(gameContentKind(p), null);
  delete p.sourceValues.upgradeState;
  p.ccus = [{instanceId:'synthetic',from:'A',to:'B',status:'unverified',applicability:'unverified',insurance:{kind:'unknown',reason:'test'}}];
  assert.equal(gameContentKind(p), null);
});
