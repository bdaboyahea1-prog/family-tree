// Grouping of the change log (see supabase/004_undo_and_photos.sql): one user action = one database
// transaction = one `txid`, so the rows of an action share it. An action can leave several rows:
// deleting a person also removes their marriages and detaches their children.

const ACTION_RANK = { DELETE: 0, INSERT: 1, UPDATE: 2 };
const TABLE_RANK = { persons: 0, marriages: 1 };

/**
 * The row that IS the action; the others are side effects of it. A deletion beats an insertion beats an
 * update, and a person beats a marriage. The database writes the rows of one deletion in no fixed order
 * (the person's own DELETE can come before or after the "children detached" updates), so the order of
 * the rows must not decide this.
 */
export function mainRow(rows) {
  return [...rows].sort(
    (a, b) =>
      (ACTION_RANK[a.action] ?? 9) - (ACTION_RANK[b.action] ?? 9) ||
      (TABLE_RANK[a.table_name] ?? 9) - (TABLE_RANK[b.table_name] ?? 9) ||
      Number(b.id) - Number(a.id),
  )[0];
}

/** Rows (newest first) -> [{ key, primary, rows }] newest action first. */
export function groupChanges(rows) {
  const groups = [];
  const byTx = new Map();
  for (const r of rows) {
    const key = r.txid ?? `row${r.id}`;
    let g = byTx.get(key);
    if (!g) {
      g = { key, primary: r, rows: [] };
      byTx.set(key, g);
      groups.push(g);
    }
    g.rows.push(r);
  }
  for (const g of groups) g.primary = mainRow(g.rows);
  return groups;
}

/** " — وفصل 2 من أبنائه، 1 سجل زواج": what else the action did. */
export function sideEffects(g) {
  const others = g.rows.filter((r) => r !== g.primary);
  if (!others.length) return '';
  const detached = others.filter((r) => r.table_name === 'persons' && r.action === 'UPDATE').length;
  const marriages = others.filter((r) => r.table_name === 'marriages').length;
  const bits = [];
  if (g.primary.action === 'DELETE' && detached) bits.push(`وفصل ${detached} من أبنائه`);
  if (marriages) bits.push(`${marriages} سجل زواج`);
  return bits.length ? ` — ${bits.join('، ')}` : ` — مع ${others.length} تغييرات مرتبطة`;
}

/**
 * The deletions to list under "deleted": the ones whose person (or marriage) is really gone now.
 * `exists(row)` says whether that record is back in the tree (restored by an undo, or recreated with the
 * same id). When something was deleted, restored and deleted again, only the newest deletion is listed.
 * `groups` come newest first (see groupChanges).
 */
export function deletedGroups(groups, exists) {
  const seen = new Set();
  return groups.filter((g) => {
    const r = g.primary;
    if (r.action !== 'DELETE' || exists(r)) return false;
    const key = `${r.table_name}:${r.record_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
