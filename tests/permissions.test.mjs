import assert from 'node:assert/strict';
import { buildIndex } from '../js/tree.js';
import { makePermissions, rightsText } from '../js/permissions.js';

let n = 0;
const P = (id, first, gender, o = {}) => ({ id, first_name: first, last_name: null, gender, father_id: null, mother_id: null, birth_date: null, created_by: null, created_at: String(++n).padStart(4, '0'), ...o });

// Same shape as the SQL self-test:  G -> S (head) -> X -> Y ; X -> D (daughter) ; G -> O ; W wife of S
const persons = [
  P('G', 'G', 'male'),
  P('S', 'S', 'male', { father_id: 'G' }),
  P('X', 'X', 'male', { father_id: 'S' }),
  P('Y', 'Y', 'male', { father_id: 'X' }),
  P('O', 'O', 'male', { father_id: 'G' }),
  P('D', 'D', 'female', { father_id: 'X' }),
  P('W', 'W', 'female'),                                 // S's wife (married in)
  P('XW', 'XW', 'female'),                               // X's wife (married in)
  P('H', 'H', 'male'),                                   // D's husband (married in)
  P('HC', 'HC', 'male', { father_id: 'H', mother_id: 'D' }),   // D & H's child: hangs under H
  P('Z', 'Z', 'male', { created_by: 'b' }),              // parentless, created by the branch user
];
const marriages = [
  { id: 'm1', person_a: 'S', person_b: 'W', created_at: '1' },
  { id: 'm2', person_a: 'X', person_b: 'XW', created_at: '2' },
  { id: 'm3', person_a: 'D', person_b: 'H', created_at: '3' },
];
const index = buildIndex(persons, marriages);
const get = (id) => index.byId.get(id);

const FULL = { add: true, edit: true, delete: true, grant: false };
const grantsOf = (obj) => new Map(Object.entries(obj));
const make = (role, grants = {}, userId = 'b') => makePermissions({ role, userId, grants: grantsOf(grants), index });

// ---- admin / editor / plain viewer ----
const admin = make('admin');
for (const p of persons) { assert.ok(admin.canWritePerson(p)); assert.ok(admin.canDeletePerson(p)); }
assert.ok(admin.canAddRoot() && admin.canAddSpouse(get('G')) && admin.canAddChild(get('G')));
assert.deepEqual(admin.delegableFlags(get('G')), { add: true, edit: true, delete: true, grant: true });

const editor = make('editor', {}, 'e');
assert.ok(editor.canWritePerson(get('G')));
assert.equal(editor.canDeletePerson(get('G')), false);
assert.equal(make('editor', {}, 'x').canDeletePerson(P('mine', 'm', 'male', { created_by: 'x' })), true);
assert.equal(editor.canDelegate(get('X')), false);

const viewer = make('viewer');
assert.equal(viewer.isBranchUser, false);
for (const p of persons) { assert.equal(viewer.canWritePerson(p), false); assert.equal(viewer.canDeletePerson(p), false); assert.equal(viewer.canAddChild(p), false); assert.equal(viewer.canDelegate(p), false); }
assert.equal(viewer.canAddRoot(), false);

// ---- branch user: add+edit+delete on S ----
const b = make('viewer', { S: FULL });
assert.equal(b.isBranchUser, true);
assert.equal(b.isBranchHead(get('S')), true);

for (const id of ['X', 'Y', 'D']) assert.equal(b.canWritePerson(get(id)), true, 'write ' + id);
for (const id of ['S', 'G', 'O', 'W']) assert.equal(b.canWritePerson(get(id)), false, 'no write ' + id);
assert.equal(b.canWritePerson(get('XW')), true);
assert.equal(b.canWritePerson(get('H')), true);
assert.equal(b.canWritePerson(get('HC')), true);
assert.equal(b.canWritePerson(get('Z')), true);
assert.equal(b.canWritePerson(P('q', 'q', 'male')), false);

assert.equal(b.canAddChild(get('S')), true);
assert.equal(b.canAddChild(get('X')), true);
assert.equal(b.canAddChild(get('D')), true);
assert.equal(b.canAddChild(get('G')), false);
assert.equal(b.canAddChild(get('O')), false);
assert.equal(b.canAddSpouse(get('X')), true);
assert.equal(b.canAddSpouse(get('S')), false);
assert.equal(b.canAddSpouse(get('G')), false);
assert.equal(b.canRemoveMarriage(get('X'), get('XW')), true);
assert.equal(b.canRemoveMarriage(get('S'), get('W')), false);

assert.equal(b.canDeletePerson(get('X')), false);  // has children
assert.equal(b.canDeletePerson(get('Y')), true);   // leaf
assert.equal(b.canDeletePerson(get('S')), false);
assert.equal(b.canDeletePerson(get('G')), false);
assert.equal(b.canDelegate(get('X')), false);      // no "grant" right

// ---- levels: each right is separate ----
const addOnly = make('viewer', { S: { add: true, edit: false, delete: false, grant: false } });
assert.equal(addOnly.canAddChild(get('X')), true);
assert.equal(addOnly.canAddSpouse(get('X')), true);
assert.equal(addOnly.canWritePerson(get('X')), false);            // no edit
assert.equal(addOnly.canDeletePerson(get('Y')), false);           // no delete
assert.equal(addOnly.canRemoveMarriage(get('X'), get('XW')), false);

const editOnly = make('viewer', { S: { add: false, edit: true, delete: false, grant: false } });
assert.equal(editOnly.canWritePerson(get('X')), true);
assert.equal(editOnly.canAddChild(get('X')), false);
assert.equal(editOnly.canAddSpouse(get('X')), false);
assert.equal(editOnly.canDeletePerson(get('Y')), false);

const deleteOnly = make('viewer', { S: { add: false, edit: false, delete: true, grant: false } });
assert.equal(deleteOnly.canDeletePerson(get('Y')), true);
assert.equal(deleteOnly.canDeletePerson(get('X')), false);        // still has children
assert.equal(deleteOnly.canWritePerson(get('Y')), false);
assert.equal(deleteOnly.canRemoveMarriage(get('X'), get('XW')), true);

// ---- delegation ----
const delegate = make('viewer', { S: { add: true, edit: true, delete: false, grant: true } });
assert.deepEqual(delegate.delegableFlags(get('X')), { add: true, edit: true, delete: false, grant: true });
assert.equal(delegate.canDelegate(get('X')), true);
assert.equal(delegate.canDelegate(get('Y')), true);
assert.equal(delegate.canDelegate(get('S')), false, 'not on his own head card');
assert.equal(delegate.canDelegate(get('G')), false, 'not above');
assert.equal(delegate.canDelegate(get('O')), false, 'not another branch');
assert.equal(delegate.canDelegate(get('W')), false);

// a delegate who holds "grant" but not "add" cannot pass "add" on
const noAdd = make('viewer', { S: { add: false, edit: true, delete: false, grant: true } });
assert.equal(noAdd.delegableFlags(get('X')).add, false);
assert.equal(noAdd.delegableFlags(get('X')).edit, true);

// nested grants: rights add up along the chain, but only from grants that carry "grant"
const nested = make('viewer', {
  S: { add: true, edit: false, delete: false, grant: true },
  X: { add: false, edit: true, delete: false, grant: true },
});
assert.deepEqual(nested.delegableFlags(get('Y')), { add: true, edit: true, delete: false, grant: true });
assert.deepEqual(nested.delegableFlags(get('D')), { add: true, edit: true, delete: false, grant: true });
assert.equal(nested.delegableFlags(get('X')).edit, false, 'X is his head here: only S above counts');

// two heads: S and O  -> O's branch becomes editable, G still not
const b2 = make('viewer', { S: FULL, O: FULL });
assert.equal(b2.canWritePerson(get('O')), false);
assert.equal(b2.canAddChild(get('O')), true);
assert.equal(b2.canWritePerson(get('G')), false);

// granting an ancestor makes the descendants editable but keeps the ancestor card locked
const b3 = make('viewer', { G: FULL });
assert.equal(b3.canWritePerson(get('G')), false);
for (const id of ['S', 'X', 'Y', 'O', 'D', 'W']) assert.equal(b3.canWritePerson(get(id)), true, id);

// a daughter's child whose father is a full member of ANOTHER branch is out of scope
const persons2 = [...persons, P('OO', 'OO', 'male', { father_id: 'O' }), P('BAD', 'BAD', 'male', { father_id: 'OO', mother_id: 'D' })];
const idx2 = buildIndex(persons2, marriages);
const bb = makePermissions({ role: 'viewer', userId: 'b', grants: grantsOf({ S: FULL }), index: idx2 });
assert.equal(bb.canWritePerson(idx2.byId.get('BAD')), false);

// loops / unknown grants must not hang
const loop = buildIndex([P('L1', 'a', 'male', { father_id: 'L2' }), P('L2', 'b', 'male', { father_id: 'L1' })]);
const bl = makePermissions({ role: 'viewer', userId: 'b', grants: grantsOf({ nobody: FULL }), index: loop });
assert.equal(bl.canWritePerson(loop.byId.get('L1')), false);
assert.equal(bl.canDelegate(loop.byId.get('L1')), false);

// labels
assert.equal(rightsText({ add: true, edit: true, delete: false, grant: false }), 'إضافة، تعديل');
assert.equal(rightsText({ add: false, edit: false, delete: false, grant: false }), 'بلا صلاحيات');
assert.equal(rightsText({ add: true, edit: true, delete: true, grant: true }), 'إضافة، تعديل، حذف، منح صلاحيات للآخرين');

console.log('PERMISSIONS OK');
