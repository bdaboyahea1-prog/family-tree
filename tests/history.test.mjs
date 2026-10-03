import assert from 'node:assert/strict';
import { groupChanges, mainRow, sideEffects, deletedGroups } from '../js/history.js';

const row = (id, action, table_name, txid, first_name = null) => ({ id, action, table_name, txid, old_data: first_name ? { first_name } : null, new_data: null });

// The real case: the deletion of "عبد الله" and the two children it detached. The database wrote the person's
// own DELETE FIRST (id 244) and the detached children after it (245, 246); the log is read newest first.
const real = [
  row(247, 'INSERT', 'persons', 9001, 'عبد الهادي'),
  row(246, 'UPDATE', 'persons', 9000, 'تولين'),
  row(245, 'UPDATE', 'persons', 9000, 'يحيى'),
  row(244, 'DELETE', 'persons', 9000, 'عبد الله'),
  row(243, 'INSERT', 'persons', 8000, 'أدهم'),
];
const groups = groupChanges(real);
assert.deepEqual(groups.map((g) => g.key), [9001, 9000, 8000], 'newest action first');
const del = groups[1];
assert.equal(del.primary.id, 244, 'the deletion is the action, not the detached child');
assert.equal(del.primary.action, 'DELETE');
assert.equal(del.rows.length, 3);
assert.equal(sideEffects(del), ' — وفصل 2 من أبنائه');
assert.deepEqual(groups.filter((g) => g.primary.action === 'DELETE').map((g) => g.key), [9000], 'it shows up under "deleted"');
assert.equal(groups[0].primary.action, 'INSERT');
assert.equal(sideEffects(groups[0]), '');

// the other order (person row last) gives the same answer
const other = [row(12, 'DELETE', 'persons', 5, 'أ'), row(11, 'UPDATE', 'persons', 5, 'ب'), row(10, 'DELETE', 'marriages', 5)];
assert.equal(groupChanges(other)[0].primary.id, 12);
assert.equal(groupChanges([...other].reverse())[0].primary.id, 12, 'whatever order the rows come in');
assert.equal(sideEffects(groupChanges(other)[0]), ' — وفصل 1 من أبنائه، 1 سجل زواج');

// a person beats a marriage, a deletion beats an update; ties: the newest row
assert.equal(mainRow([row(1, 'DELETE', 'marriages', 1), row(2, 'DELETE', 'persons', 1)]).id, 2);
assert.equal(mainRow([row(3, 'DELETE', 'marriages', 1), row(2, 'DELETE', 'persons', 1)]).id, 2, 'person first even when older');
assert.equal(mainRow([row(5, 'UPDATE', 'persons', 1), row(4, 'INSERT', 'persons', 1)]).id, 4, 'an insertion beats an update');
assert.equal(mainRow([row(7, 'INSERT', 'persons', 1), row(8, 'INSERT', 'persons', 1)]).id, 8);
assert.equal(mainRow([row(7, 'UPDATE', 'marriages', 1), row(6, 'UPDATE', 'persons', 1)]).id, 6);
assert.equal(mainRow([row(1, 'INSERT', 'persons', 1)]).id, 1);

// rows without a txid (old log rows) stay separate actions
const old = groupChanges([row(3, 'UPDATE', 'persons', null), row(2, 'DELETE', 'persons', null), row(1, 'INSERT', 'persons', null)]);
assert.equal(old.length, 3);
assert.deepEqual(old.map((g) => g.primary.id), [3, 2, 1]);

assert.equal(sideEffects({ primary: real[1], rows: [real[1], row(1, 'INSERT', 'marriages', 1)] }), ' — 1 سجل زواج');
// ---------- the "deleted" list ----------
const rec = (id, action, table_name, txid, record_id) => ({ ...row(id, action, table_name, txid), record_id });
const log = [
  rec(30, 'DELETE', 'persons', 3, 'p1'), // p1 deleted again, newest
  rec(25, 'INSERT', 'persons', 2, 'p1'), // p1 restored by an undo
  rec(21, 'DELETE', 'persons', 1, 'p1'), // p1 deleted first
  rec(20, 'DELETE', 'persons', 0, 'p2'), // p2 deleted and never restored
  rec(15, 'DELETE', 'marriages', 9, 'm1'), // m1 deleted, then restored
  rec(10, 'DELETE', 'persons', 8, 'p3'), // p3 deleted, then restored
];
const gs = groupChanges(log);
const present = new Set(['m1', 'p3']);
const existsIn = (set) => (r) => set.has(r.record_id);
assert.deepEqual(deletedGroups(gs, existsIn(present)).map((g) => g.primary.record_id), ['p1', 'p2'], 'restored ones leave the list; p1 only once, newest deletion');
assert.deepEqual(deletedGroups(gs, existsIn(present)).map((g) => g.key), [3, 0]);
assert.deepEqual(deletedGroups(gs, existsIn(new Set(['p1', 'p2', 'm1', 'p3']))).map((g) => g.primary.record_id), [], 'all back -> the list is empty');
assert.deepEqual(deletedGroups(gs, existsIn(new Set())).map((g) => g.primary.record_id), ['p1', 'p2', 'm1', 'p3'], 'nothing restored -> all listed');
assert.deepEqual(deletedGroups([], () => false), []);
console.log('HISTORY OK');
