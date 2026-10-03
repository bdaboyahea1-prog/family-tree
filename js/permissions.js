// What the current user may do in the UI. This MIRRORS the rules enforced by the database
// (supabase/002_ and 003_*.sql): it only decides which buttons to show. The database stays
// the real guard and refuses anything this file wrongly allows.
//
//   admin   -> everything
//   editor  -> add / edit anyone, delete only what they created
//   viewer  -> read only, unless granted a branch ("branch head") with levels:
//                add    create people / marriages below the head
//                edit   change cards below the head
//                delete remove cards below the head (only those nobody hangs under)
//                grant  invite people / give rights on branches BELOW them, never more than
//                       they hold themselves
//              The head's own card, its wives, everything above and other branches are
//              never writable.
import { lineParent } from './tree.js';

export const FLAGS = ['add', 'edit', 'delete', 'grant'];
export const FLAG_LABEL = { add: 'إضافة', edit: 'تعديل', delete: 'حذف', grant: 'منح صلاحيات للآخرين' };

/** "إضافة، تعديل" for a { add, edit, delete, grant } object. */
export function rightsText(flags) {
  return FLAGS.filter((f) => flags && flags[f]).map((f) => FLAG_LABEL[f]).join('، ') || 'بلا صلاحيات';
}

/**
 * @param grants Map<personId, {add, edit, delete, grant}>  (branch heads granted to this user)
 */
export function makePermissions({ role, userId, grants = new Map(), index }) {
  const isGlobal = role === 'admin' || role === 'editor';
  const isBranchUser = !isGlobal && role === 'viewer' && grants.size > 0;
  const hasFlag = (flag) => [...grants.values()].some((f) => f[flag]);

  /** Is `startId` a person on which I hold `flag`, or below one? (inclusive climb up the chart) */
  const underGrant = (startId, flag) => {
    const seen = new Set();
    let cur = index.byId.get(startId);
    while (cur && !seen.has(cur.id)) {
      const g = grants.get(cur.id);
      if (g && g[flag]) return true;
      seen.add(cur.id);
      cur = lineParent(index, cur);
    }
    return false;
  };

  /** Strictly below such a person (the head itself is not "in" the branch). */
  const inBranch = (p, flag) => {
    const lp = p && lineParent(index, p);
    return !!lp && underGrant(lp.id, flag);
  };

  const parentless = (p) => !p.father_id && !p.mother_id;
  // Only recorded marriages count (the database looks at the marriages table, not at shared children).
  const spouseInBranch = (p, flag) => (index.spouses.get(p.id) || []).some((s) => s.marriage && inBranch(s.person, flag));
  const marriedInScope = (p, flag) => !!p && parentless(p) && ((p.created_by === userId && hasFlag(flag)) || spouseInBranch(p, flag));
  const scopeOk = (id, flag) => underGrant(id, flag) || marriedInScope(index.byId.get(id), flag);

  const writeOk = (p, flag) => {
    if (isGlobal) return true;
    if (!isBranchUser || !hasFlag(flag)) return false;
    const lp = lineParent(index, p);
    if (lp) return scopeOk(lp.id, flag);
    return p.created_by === userId || spouseInBranch(p, flag);
  };

  const hasKids = (p) => (index.kids.get(p.id) || []).length > 0;

  /** Rights I may hand out on this card: null if none. Admin: everything, anywhere. */
  const delegableFlags = (person) => {
    if (role === 'admin') return { add: true, edit: true, delete: true, grant: true };
    if (!isBranchUser) return null;
    const start = lineParent(index, person);
    if (!start) return null;
    const out = { add: false, edit: false, delete: false, grant: false };
    let any = false;
    const seen = new Set();
    let cur = start;
    while (cur && !seen.has(cur.id)) {
      const g = grants.get(cur.id);
      if (g && g.grant) {
        any = true;
        for (const f of FLAGS) out[f] = out[f] || !!g[f];
      }
      seen.add(cur.id);
      cur = lineParent(index, cur);
    }
    return any ? out : null;
  };

  const perms = {
    role,
    isGlobal,
    isBranchUser,

    /** Edit this card (name, dates, parents...). */
    canWritePerson: (p) => writeOk(p, 'edit'),

    canDeletePerson(p) {
      if (role === 'admin') return true;
      if (role === 'editor') return p.created_by === userId;
      return writeOk(p, 'delete') && !hasKids(p);
    },

    /** Add a son/daughter to `parent` (needs the "add" right). */
    canAddChild(parent) {
      if (isGlobal) return true;
      if (!isBranchUser || !hasFlag('add')) return false;
      if (scopeOk(parent.id, 'add')) return true;
      // a daughter outside the chain can still have children under a husband who is in scope
      return parent.gender === 'female' && (index.spouses.get(parent.id) || []).some((s) => scopeOk(s.person.id, 'add'));
    },

    /** Add a wife/husband to `person`: only for people strictly inside the branch. */
    canAddSpouse: (person) => isGlobal || (isBranchUser && inBranch(person, 'add')),

    /** Remove a marriage (needs the "delete" right on one side). */
    canRemoveMarriage: (a, b) => isGlobal || (isBranchUser && (inBranch(a, 'delete') || inBranch(b, 'delete'))),

    /** Is this person the head of one of my branches? And what do I hold there? */
    isBranchHead: (p) => grants.has(p.id),
    rightsAtHead: (p) => grants.get(p.id) || null,

    /** Add a brand-new person with no parents (the first ancestor). */
    canAddRoot: () => isGlobal,

    delegableFlags,
    canDelegate: (person) => !!delegableFlags(person),

    underGrant,
    inBranch,
  };
  return perms;
}
