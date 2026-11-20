import test from 'node:test';import assert from 'node:assert/strict';import {pledgeDate,pledgeDateLabel,comparePledgeDates} from '../src/domain/pledge-date';
const p=(date:string)=>({sourceValues:{date}});
test('RSI calendar dates are retained without guessing a timezone or changing a gift into a purchase',()=>{
 for(const raw of ['Nov 14, 2026','November 14, 2026','Nov 14, 2026, 11:15 pm','14.11.2026','2026-11-14','2026-11-14T23:15:00-08:00'])assert.equal(pledgeDate(p(raw)),'2026-11-14');
 assert.equal(pledgeDateLabel(p('Nov 14, 2026'),'de',true),'14.11.26');assert.equal(pledgeDateLabel(p('Nov 14, 2026'),'en'),'2026-11-14');
});
test('default order is newest first with valid source time, stable ties and unknown dates last without mutating source data',()=>{
 const rows=[{id:'unknown',...p('')},{id:'older',...p('Nov 14, 2026')},{id:'early',...p('Nov 15, 2026, 11:00 am')},{id:'late',...p('Nov 15, 2026, 1:00 pm')},{id:'tie',...p('Nov 15, 2026, 1:00 pm')},{id:'no-clock',...p('Nov 15, 2026')}],before=JSON.stringify(rows);
 assert.deepEqual([...rows].sort(comparePledgeDates).map(r=>r.id),['late','tie','early','no-clock','older','unknown']);assert.equal(JSON.stringify(rows),before);assert.equal(comparePledgeDates(undefined,p('invalid')),0);
});

test('RSI Created label preserves exact calendar validation and newest-first ordering without parsing unrelated labels',()=>{
 for(const raw of ['Created: November 14, 2026','Created:  November 14, 2026, 1:00 pm','Erstellt: 14.11.2026'])assert.equal(pledgeDate(p(raw)),'2026-11-14');
 for(const raw of ['Order Created: November 14, 2026','Created: Feb 30, 2026','Created:','Created: 2026-11-14T99:99:99Z'])assert.equal(pledgeDate(p(raw)),null);
 const old=p('Created: November 13, 2026'),recent=p('Created: November 14, 2026');assert.ok(comparePledgeDates(recent,old)<0);assert.equal(old.sourceValues.date,'Created: November 13, 2026');
});
test('missing, ambiguous, invalid and unrelated dates do not become an acquisition date',()=>{
 for(const raw of ['', '11/14/2026','14/11/2026','2026-02-30','Feb 29, 2025','2026-13-01','1.1.1900','Order 14 Nov 2026','<script>Nov 14, 2026</script>','November 14, 2026 99:99','Novfoo 14, 2026','2026-11-14T99:99:99Z'])assert.equal(pledgeDate(p(raw)),null,raw);
 assert.equal(pledgeDate({sourceValues:{importedAt:'2026-11-14'}}),null);assert.equal(pledgeDate(p('Feb 29, 2024')),'2024-02-29');
});
