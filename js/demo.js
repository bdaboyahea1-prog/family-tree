// Read-only sample family used by  #/demo  to preview the chart without signing in.
let n = 0;
const P = (id, first_name, gender, o = {}) => ({
  id, tree_id: 'demo', first_name, last_name: 'الراشد', gender,
  father_id: null, mother_id: null, birth_date: null, birth_place: null,
  is_deceased: false, death_date: null, photo_url: null, notes: null,
  created_by: null, created_at: String(++n).padStart(4, '0'), ...o,
});

export const demoPersons = [
  P('g', 'سالم', 'male', { birth_date: '1915', is_deceased: true, death_date: '1990', nickname: 'أبو عبدالله' }),
  P('w1', 'مريم', 'female', { last_name: 'العلي', birth_date: '1920', is_deceased: true, death_date: '1975' }),
  P('w2', 'حصة', 'female', { last_name: 'السعد', birth_date: '1930', is_deceased: true, death_date: '2005' }),

  P('a', 'عبدالله', 'male', { father_id: 'g', mother_id: 'w1', birth_date: '1940', nickname: 'أبو محمد' }),
  P('b', 'فاطمة', 'female', { father_id: 'g', mother_id: 'w1', birth_date: '1943' }),
  P('c', 'أحمد', 'male', { father_id: 'g', mother_id: 'w1', birth_date: '1946', is_deceased: true, death_date: '2019' }),
  P('d', 'خالد', 'male', { father_id: 'g', mother_id: 'w2', birth_date: '1952', nickname: 'الحاج' }),
  P('e', 'نورة', 'female', { father_id: 'g', mother_id: 'w2', birth_date: '1955' }),

  P('aw', 'سارة', 'female', { last_name: 'المطيري', birth_date: '1945' }),
  P('a1', 'محمد', 'male', { father_id: 'a', mother_id: 'aw', birth_date: '1968' }),
  P('a2', 'ليلى', 'female', { father_id: 'a', mother_id: 'aw', birth_date: '1971' }),
  P('a3', 'يوسف', 'male', { father_id: 'a', mother_id: 'aw', birth_date: '1975' }),

  P('bh', 'ناصر', 'male', { last_name: 'الحربي', birth_date: '1938' }),
  P('b1', 'هند', 'female', { last_name: 'الحربي', father_id: 'bh', mother_id: 'b', birth_date: '1966' }),
  P('b2', 'فيصل', 'male', { last_name: 'الحربي', father_id: 'bh', mother_id: 'b', birth_date: '1970' }),

  P('cw', 'منيرة', 'female', { last_name: 'القحطاني', birth_date: '1950' }),
  P('c1', 'عمر', 'male', { father_id: 'c', mother_id: 'cw', birth_date: '1975' }),

  P('dw', 'جواهر', 'female', { last_name: 'الدوسري', birth_date: '1958' }),
  P('d1', 'تركي', 'male', { father_id: 'd', mother_id: 'dw', birth_date: '1982' }),
  P('d2', 'ريم', 'female', { father_id: 'd', mother_id: 'dw', birth_date: '1985' }),

  P('m1w', 'دانة', 'female', { last_name: 'الشمري', birth_date: '1972' }),
  P('m11', 'سلطان', 'male', { father_id: 'a1', mother_id: 'm1w', birth_date: '1998' }),
  P('m12', 'لمى', 'female', { father_id: 'a1', mother_id: 'm1w', birth_date: '2001' }),
  P('y1w', 'عائشة', 'female', { last_name: 'العتيبي', birth_date: '1980' }),
  P('y11', 'راشد', 'male', { father_id: 'a3', mother_id: 'y1w', birth_date: '2006' }),
  P('f1w', 'جود', 'female', { last_name: 'الغامدي', birth_date: '1995' }),
  P('f11', 'مها', 'female', { father_id: 'b2', mother_id: 'f1w', birth_date: '2020' }),
];

// Where people live now / were born (sample data for the pickers and the search page): [country, province, city]
const RESIDENCE = {
  g: ['SY', 'دمشق', 'دمشق'], a: ['SY', 'دمشق', 'دمشق'], b: ['SY', 'حلب', 'حلب'], c: ['EG', 'القاهرة', 'القاهرة'],
  d: ['SA', 'منطقة الرياض', 'الرياض'], e: ['SA', 'منطقة مكة المكرمة', 'جدة'], a1: ['DE', 'Berlin', 'Berlin'],
  a2: ['SY', 'دمشق', 'دمشق'], a3: ['SA', 'منطقة الرياض', 'الرياض'], b1: ['SY', 'حلب', 'حلب'], b2: ['TR', 'İstanbul', 'Fatih'],
  c1: ['EG', 'القاهرة', 'القاهره'], d1: ['SA', 'منطقة الرياض', 'الرياض'], d2: ['AE', 'دبي', 'دبي'],
  m11: ['DE', 'Berlin', 'Berlin'], m12: ['DE', 'Bayern', 'München'], y11: ['SA', 'منطقة مكة المكرمة', 'جدة'],
  bh: ['SY', 'حلب', 'حلب'], dw: ['SA', 'منطقة الرياض', 'الرياض'],
};
const BIRTH = {
  g: ['SY', 'حمص', 'حمص'], a: ['SY', 'دمشق', 'دمشق'], b: ['SY', 'حلب', 'حلب'], c: ['SY', 'ريف دمشق', 'دوما'],
  d: ['SY', 'حمص', 'تدمر'], e: ['SY', 'حمص', 'حمص'], a1: ['SY', 'دمشق', 'دمشق'], a2: ['SY', 'دمشق', 'دمشق'],
  a3: ['SA', 'منطقة الرياض', 'الرياض'], b1: ['SY', 'حلب', 'حلب'], b2: ['SY', 'حلب', 'منبج'],
  c1: ['EG', 'القاهرة', 'القاهرة'], d1: ['SA', 'منطقة الرياض', 'الرياض'], m11: ['DE', 'Berlin', 'Berlin'],
};
for (const p of demoPersons) {
  const [rc, rp, rt] = RESIDENCE[p.id] || [null, null, null];
  const [bc, bp, bt] = BIRTH[p.id] || [null, null, null];
  Object.assign(p, {
    residence_country: rc, residence_province: rp, residence_city: rt,
    birth_country: bc, birth_province: bp, birth_city: bt,
  });
}

// Sample contact details: obviously fake numbers and example.com addresses
const CONTACT = {
  a: ['+000 111 222 301', 'abdullah@example.com'], a1: ['+000 111 222 302', null], c: [null, 'ahmad@example.com'],
  m11: ['+49 170 0000000', 'sultan@example.com'], d: ['+000 111 222 304', null],
};
for (const p of demoPersons) {
  const [phone, email] = CONTACT[p.id] || [null, null];
  Object.assign(p, { phone, email });
}

/** A generic sample of the designer's note (the real one is stored in the database, members only). */
export const demoAbout = {
  name: 'اسم المصمم (مثال)',
  place: 'المدينة، المحافظة، البلد',
  greeting: 'السلام عليكم ورحمة الله وبركاته',
  text: 'هذا نص تجريبي يوضّح شكل النبذة.\n\nيكتب المدير نبذته الحقيقية من داخل التطبيق، وتظهر لأعضاء الشجرة فقط.',
  phone: '+000 000 000 000',
  email: 'designer@example.com',
};

/**
 * A tiny in-memory stand-in for the Supabase client, used ONLY by the #/demo-* pages so the
 * sharing / invitation / branch dialogs can be tried without an account. Nothing is sent anywhere.
 */
/** What the public page of the demo tree shows (the same rules as public_teaser() in supabase/010). */
function fakeTeaser(tree) {
  if (!tree.public_page) return null;
  const show = !!tree.public_show_living;
  const lp = (p) => p.father_id || p.mother_id || null;
  const lineSize = (id) => 1 + demoPersons.filter((p) => lp(p) === id).reduce((n, c) => n + lineSize(c.id), 0);
  const roots = demoPersons.filter((p) => !p.father_id && !p.mother_id).map((p) => ({ p, n: lineSize(p.id) })).filter((r) => r.n > 1);
  roots.sort((a, b) => b.n - a.n || (b.p.gender === 'male') - (a.p.gender === 'male'));
  const year = (t) => (String(t || '').match(/[0-9]{4}/) || [null])[0];
  // like the database (supabase/016): a child of the top ancestor is written with the father's name in the middle
  const written = (p, dad) => {
    const ends = dad && p.first_name !== dad && p.first_name.endsWith(' ' + dad);
    return [p.first_name, dad && !ends ? dad : '', p.last_name].filter(Boolean).join(' ');
  };
  const card = (p, dad = null) => (!p.is_deceased && !show ? null : { name: written(p, dad), gender: p.gender, birth_year: p.is_deceased && year(p.birth_date) ? Number(year(p.birth_date)) : null, death_year: p.is_deceased && year(p.death_date) ? Number(year(p.death_date)) : null, deceased: !!p.is_deceased });
  const top = roots[0]?.p;
  const root = top ? card(top) : null;
  const kids = top ? demoPersons.filter((p) => lp(p) === top.id) : [];
  const shown = root ? kids.map((c) => card(c, c.father_id === top.id ? top.first_name : null)).filter(Boolean) : [];
  return { tree_id: tree.id, tree_name: tree.name, people_count: demoPersons.length, root, children: shown.slice(0, 24), hidden_children: kids.length - Math.min(shown.length, 24) };
}

export function makeFakeSb(userId = 'u1', opts = {}) {
  const db = {
    trees: [{ id: 'demo', name: 'عائلة الراشد (عرض تجريبي)', about: null, female_card_mode: 'full', public_page: !!opts.publicPage, public_show_living: false }],
    // a request to join, waiting for the admin (migration 010)
    join_requests: [
      { id: 'j1', tree_id: 'demo', user_id: null, full_name: 'خالد أحمد (طلب تجريبي)', relation: 'أنا خالد بن أحمد بن يوسف، من فرع عمي عبدالله، وجدّي الأكبر سالم.', residence_country: 'DE', residence_city: 'Berlin', phone: '+49 170 1234567', contact_email: 'khaled.visitor@example.com', doc_path: 'req/j1.pdf', status: 'pending', track_code: 'c'.repeat(32), doc_uploaded: true, invite_code: null, decided_by: null, decided_at: null, decision_note: null, created_at: new Date(Date.now() - 5400e3).toISOString() },
      // for the demo front page: type these codes in "لدي رقم متابعة" (aaaa… = accepted, bbbb… = refused)
      { id: 'j2', tree_id: 'demo', user_id: null, full_name: 'سلمى (طلب تجريبي مقبول)', relation: 'أنا سلمى بنت يوسف، من فرع خالد.', residence_country: 'TR', residence_city: 'Hatay', phone: '+90 532 111 2233', contact_email: 'salma.visitor@example.com', doc_path: null, status: 'approved', track_code: 'a'.repeat(32), doc_uploaded: true, invite_code: 'dddddddddddddddd', decided_by: 'u1', decided_at: new Date(Date.now() - 3600e3).toISOString(), decision_note: null, created_at: new Date(Date.now() - 86400e3).toISOString() },
      // no phone and no e-mail: approved, so the page asks for an e-mail (eeee… = this one, ffff… = waiting without any contact)
      { id: 'j4', tree_id: 'demo', user_id: null, full_name: 'ليلى (طلب مقبول بلا بريد)', relation: 'أنا ليلى بنت سالم، من فرع علي.', residence_country: 'SA', residence_city: null, phone: null, contact_email: null, doc_path: null, status: 'approved', track_code: 'e'.repeat(32), doc_uploaded: false, invite_code: null, invite_claimed: false, decided_by: 'u1', decided_at: new Date(Date.now() - 1800e3).toISOString(), decision_note: null, created_at: new Date(Date.now() - 3 * 3600e3).toISOString() },
      { id: 'j5', tree_id: 'demo', user_id: null, full_name: 'عمر (طلب بلا وسيلة تواصل)', relation: 'أنا عمر بن حسن، من فرع يحيى.', residence_country: 'NL', residence_city: null, phone: null, contact_email: null, doc_path: null, status: 'pending', track_code: 'f'.repeat(32), doc_uploaded: false, invite_code: null, invite_claimed: false, decided_by: null, decided_at: null, decision_note: null, created_at: new Date(Date.now() - 1200e3).toISOString() },
      { id: 'j3', tree_id: 'demo', user_id: null, full_name: 'زائر (طلب تجريبي مرفوض)', relation: 'ذكرتُ أنني من العائلة.', residence_country: 'SY', residence_city: 'Jableh', phone: '+000 111 222 305', contact_email: 'refused.visitor@example.com', doc_path: null, status: 'rejected', track_code: 'b'.repeat(32), doc_uploaded: true, invite_code: null, decided_by: 'u1', decided_at: new Date(Date.now() - 7200e3).toISOString(), decision_note: 'الوثيقة غير واضحة، أعد رفعها بصورة أوضح.', created_at: new Date(Date.now() - 2 * 86400e3).toISOString() },
    ],
    // information rows of a woman's card (migration 009): sons / daughters written as information, not as cards
    card_info: [
      { id: 'i1', tree_id: 'demo', person_id: 'b', kind: 'son', first_name: 'ماجد', last_name: 'الحربي', birth_date: '1970', death_date: null, is_deceased: false, birth_country: 'SA', birth_province: 'منطقة الرياض', birth_city: 'الرياض', birth_place: null, residence_country: 'SA', residence_province: null, residence_city: 'الرياض', phone: '+000 111 222 777', email: null, notes: 'مثال للعرض', created_at: '2026-09-30T10:00:00Z' },
      { id: 'i2', tree_id: 'demo', person_id: 'b', kind: 'daughter', first_name: 'سلمى', last_name: 'الحربي', birth_date: '1974', death_date: '2020', is_deceased: true, birth_country: null, birth_province: null, birth_city: null, birth_place: null, residence_country: null, residence_province: null, residence_city: null, phone: null, email: null, notes: null, created_at: '2026-09-30T10:05:00Z' },
    ],
    tree_members: [
      { tree_id: 'demo', user_id: 'u1', role: 'admin', joined_at: '1', profile: { display_name: 'أنا (المدير)' } },
      { tree_id: 'demo', user_id: 'u2', role: 'viewer', joined_at: '2', profile: { display_name: 'سعد' } },
      { tree_id: 'demo', user_id: 'u3', role: 'viewer', joined_at: '3', profile: { display_name: 'منى' } },
      { tree_id: 'demo', user_id: 'u4', role: 'admin', joined_at: '4', profile: { display_name: 'مدير ثانٍ' } },
    ],
    tree_invites: [
      { code: 'dddddddddddddddd', tree_id: 'demo', role: 'viewer', email: 'salma.visitor@example.com', branch_person_id: null, can_add: true, can_edit: true, can_delete: false, can_grant: false, enabled: true, uses: 0, max_uses: 1, created_at: '3' },
      { code: 'aaaaaaaaaaaaaaaa', tree_id: 'demo', role: 'viewer', email: 'khaled@example.com', branch_person_id: 'a', can_add: true, can_edit: true, can_delete: false, can_grant: false, enabled: true, uses: 0, max_uses: 1, created_at: '1' },
      { code: 'bbbbbbbbbbbbbbbb', tree_id: 'demo', role: 'viewer', email: 'old@example.com', branch_person_id: 'a', can_add: true, can_edit: false, can_delete: false, can_grant: false, enabled: false, uses: 1, max_uses: 1, created_at: '0' },
      { code: '1111111111111111', tree_id: 'demo', role: 'viewer', email: null, any_email: true, label: 'ابن عمي في كندا', branch_person_id: null, can_add: true, can_edit: true, can_delete: false, can_grant: false, enabled: true, uses: 0, max_uses: 1, used_by: null, created_at: '4' },
      { code: '2222222222222222', tree_id: 'demo', role: 'viewer', email: null, any_email: true, label: 'خالتي سعاد', branch_person_id: null, can_add: true, can_edit: true, can_delete: false, can_grant: false, enabled: false, uses: 1, max_uses: 1, used_by: 'u3', created_at: '5' },
      { code: 'cccccccccccccccc', tree_id: 'demo', role: 'editor', email: 'nora@example.com', branch_person_id: null, can_add: true, can_edit: true, can_delete: false, can_grant: false, enabled: true, uses: 0, max_uses: 1, created_at: '2' },
    ],
    branch_grants: [
      { tree_id: 'demo', user_id: 'u2', person_id: 'a', can_add: true, can_edit: true, can_delete: false, can_grant: true, created_by: 'u1' },
    ],
    card_comments: [
      { id: 'c1', tree_id: 'demo', person_id: 'a', user_id: 'u2', body: 'وُلد جدي في حمص قبل أن ينتقل إلى دمشق.', created_at: new Date(Date.now() - 5 * 3600e3).toISOString() },
      { id: 'c2', tree_id: 'demo', person_id: 'a', user_id: 'u3', body: 'عندي صورة قديمة له، سأرفعها قريبًا.', created_at: new Date(Date.now() - 3600e3).toISOString() },
    ],
    access_requests: [
      { id: 'r1', tree_id: 'demo', person_id: 'a1', user_id: 'u3', can_add: true, can_edit: true, can_delete: false, message: 'أريد تحديث بيانات فرع عمي محمد.', status: 'pending', created_at: new Date(Date.now() - 7200e3).toISOString(), decided_by: null, decision_note: null },
      { id: 'r0', tree_id: 'demo', person_id: 'c', user_id: 'u2', can_add: true, can_edit: false, can_delete: false, message: null, status: 'rejected', created_at: new Date(Date.now() - 86400e3).toISOString(), decided_by: 'u1', decision_note: 'لا حاجة الآن' },
    ],
    card_reports: [
      { id: 'p1', tree_id: 'demo', person_id: 'a1', user_id: 'u3', message: 'سنة الميلاد خاطئة، الصحيح 1967.', status: 'open', created_at: new Date(Date.now() - 1800e3).toISOString(), resolution_note: null },
      { id: 'p0', tree_id: 'demo', person_id: 'b', user_id: 'u2', message: 'اسم العائلة ينقصه حرف.', status: 'resolved', created_at: new Date(Date.now() - 2 * 86400e3).toISOString(), resolution_note: 'صُحّح' },
    ],
    change_log: [
      // deleted and then restored (the person is back in the tree): stays in the log, leaves the "deleted" list
      { id: 6, tree_id: 'demo', user_id: 'u2', action: 'DELETE', table_name: 'persons', record_id: 'm11', old_data: { first_name: 'سلطان', last_name: 'الراشد' }, new_data: null, created_at: new Date(Date.now() - 7200e3).toISOString(), txid: 101 },
      // a deletion: the database writes the person's own DELETE first (lowest id), the detached children after it
      { id: 5, tree_id: 'demo', user_id: 'u2', action: 'UPDATE', table_name: 'persons', record_id: 'x3', old_data: { father_id: 'x1' }, new_data: { father_id: null }, created_at: new Date(Date.now() - 3600e3).toISOString(), txid: 100 },
      { id: 4, tree_id: 'demo', user_id: 'u2', action: 'UPDATE', table_name: 'persons', record_id: 'x2', old_data: { father_id: 'x1' }, new_data: { father_id: null }, created_at: new Date(Date.now() - 3600e3).toISOString(), txid: 100 },
      { id: 3, tree_id: 'demo', user_id: 'u2', action: 'DELETE', table_name: 'persons', record_id: 'x1', old_data: { first_name: 'فهد', last_name: 'الراشد' }, new_data: null, created_at: new Date(Date.now() - 3600e3).toISOString(), txid: 100 },
      { id: 2, tree_id: 'demo', user_id: 'u1', action: 'UPDATE', table_name: 'persons', record_id: 'a', old_data: { first_name: 'عبدالله', birth_date: '1939', residence_city: null }, new_data: { first_name: 'عبدالله', birth_date: '1940', residence_city: 'دمشق' }, created_at: new Date(Date.now() - 86400e3).toISOString(), txid: 99 },
      { id: 1, tree_id: 'demo', user_id: 'u3', action: 'INSERT', table_name: 'persons', record_id: 'm11', old_data: null, new_data: { first_name: 'سلطان', last_name: 'الراشد' }, created_at: new Date(Date.now() - 2 * 86400e3).toISOString(), txid: 98 },
    ],
  };
  const query = (table) => {
    const s = { op: 'select', filters: [], patch: null, sel: false, single: false };
    const match = (r) => s.filters.every(([c, v]) => r[c] === v);
    const copy = (rows) => rows.map((r) => ({ ...r }));
    const run = () => {
      const rows = (db[table] = db[table] || []);
      let hit = [];
      if (s.op === 'insert') {
        const defaults = table === 'join_requests' ? { status: 'pending', decided_by: null, decided_at: null, decision_note: null } : {};
        hit = (Array.isArray(s.patch) ? s.patch : [s.patch]).map((r) => ({ id: 'n' + Math.random().toString(16).slice(2, 8), created_at: new Date().toISOString(), user_id: userId, ...defaults, ...r }));
        rows.push(...hit);
      } else if (s.op === 'update') {
        hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, s.patch));
      } else if (s.op === 'delete') {
        hit = rows.filter(match);
        db[table] = rows.filter((r) => !match(r));
      } else {
        return { data: copy(rows.filter(match)), error: null };
      }
      if (!s.sel) return { data: null, error: null }; // like the real API: rows come back only after .select()
      if (!s.single) return { data: copy(hit), error: null };
      return hit.length ? { data: { ...hit[0] }, error: null } : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    };
    const api = {
      select: () => ((s.sel = true), api),
      single: () => ((s.single = true), api),
      order: () => api,
      limit: () => api,
      eq: (c, v) => (s.filters.push([c, v]), api),
      insert: (row) => ((s.op = 'insert'), (s.patch = row), api),
      update: (p) => ((s.op = 'update'), (s.patch = p), api),
      delete: () => ((s.op = 'delete'), api),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return api;
  };
  const code = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0') + Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  const docImage = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="#f6f4ef"/><rect x="12" y="12" width="456" height="276" fill="none" stroke="#999" stroke-dasharray="6"/><text x="240" y="150" font-size="26" text-anchor="middle" fill="#444">وثيقة تجريبية (صورة وهمية)</text></svg>')}`;
  return {
    // storage: the documents of join requests (nothing is really kept)
    storage: {
      from: () => ({
        upload: async () => ({ data: {}, error: null }),
        remove: async () => ({ data: [], error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: docImage }, error: null }),
      }),
    },
    from: query,
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
    rpc: async (name, a) => {
      if (name === 'create_branch_invite' || name === 'create_invite') {
        const c = code();
        db.tree_invites.push({
          code: c, tree_id: 'demo', role: a.p_role || 'viewer', email: String(a.p_email).trim().toLowerCase(),
          branch_person_id: a.p_person || null, can_add: !!a.p_add, can_edit: !!a.p_edit, can_delete: !!a.p_delete, can_grant: !!a.p_grant,
          enabled: true, uses: 0, max_uses: 1, created_at: String(Date.now()),
        });
        return { data: c, error: null };
      }
      if (name === 'create_open_invite') {
        if (db.tree_invites.filter((i) => i.any_email && i.enabled && i.uses < i.max_uses).length >= 30) return { data: null, error: { message: 'too many open invitations' } };
        const c = code().slice(0, 16);
        db.tree_invites.push({ code: c, tree_id: 'demo', role: 'viewer', email: null, any_email: true, label: String(a.p_label || '').trim().slice(0, 100) || null, branch_person_id: null, can_add: true, can_edit: true, can_delete: false, can_grant: false, enabled: true, uses: 0, max_uses: 1, used_by: null, created_at: String(Date.now()) });
        return { data: c, error: null };
      }
      if (name === 'grant_branch') {
        db.branch_grants = db.branch_grants.filter((g) => !(g.user_id === a.p_user && g.person_id === a.p_person));
        db.branch_grants.push({ tree_id: 'demo', user_id: a.p_user, person_id: a.p_person, can_add: a.p_add, can_edit: a.p_edit, can_delete: a.p_delete, can_grant: a.p_grant, created_by: 'u1' });
        return { data: null, error: null };
      }
      if (name === 'revoke_branch') {
        db.branch_grants = db.branch_grants.filter((g) => !(g.user_id === a.p_user && g.person_id === a.p_person));
        return { data: null, error: null };
      }
      if (name === 'can_create_tree') return { data: userId === 'u1', error: null };
      if (name === 'public_teaser') return { data: fakeTeaser(db.trees[0]), error: null };
      if (name === 'submit_join_request') {
        const hex = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
        const id = 'jr' + Math.random().toString(16).slice(2, 8);
        const track = hex();
        const path = a.p_doc_ext ? `req/${id}.${a.p_doc_ext}` : null; // no document: opened to the admin at once
        const mail = String(a.p_email || '').trim().toLowerCase() || null; // optional
        if (mail && db.join_requests.some((x) => x.contact_email === mail && x.status === 'pending')) return { data: null, error: { message: 'request already open' } };
        db.join_requests.push({ id, tree_id: a.p_tree, user_id: null, full_name: a.p_full_name, relation: a.p_relation, residence_country: a.p_country, residence_city: a.p_city || null, phone: String(a.p_phone || '').trim() || null, contact_email: mail, doc_path: path, status: path ? 'draft' : 'pending', track_code: track, doc_uploaded: false, invite_code: null, invite_claimed: false, decided_by: null, decided_at: null, decision_note: null, created_at: new Date().toISOString() });
        return { data: { id, code: track, path }, error: null };
      }
      if (name === 'confirm_join_doc') {
        const r = db.join_requests.find((x) => x.id === a.p_id && x.track_code === a.p_code && x.status === 'draft');
        if (!r) return { data: null, error: { message: 'request not found' } };
        r.doc_uploaded = true;
        r.status = 'pending';
        return { data: null, error: null };
      }
      if (name === 'join_status') {
        const r = db.join_requests.find((x) => x.track_code === a.p_code);
        if (!r) return { data: null, error: null };
        const inv = r.invite_code && db.tree_invites.find((i) => i.code === r.invite_code);
        return { data: { status: r.status, full_name: r.full_name, contact_email: r.contact_email, created_at: r.created_at, decision_note: r.decision_note, invite_code: inv && inv.enabled && inv.uses < inv.max_uses ? inv.code : null, registered: !!inv && inv.uses >= inv.max_uses, needs_email: r.status === 'approved' && !r.contact_email && !r.invite_code, claimed: !!r.invite_claimed }, error: null };
      }
      if (name === 'decide_join_request') {
        const r = db.join_requests.find((x) => x.id === a.p_id);
        if (!r || r.status !== 'pending') return { data: null, error: { message: 'request already decided' } };
        r.status = a.p_approve ? 'approved' : 'rejected';
        r.decision_note = a.p_note || null;
        let invite = null;
        if (a.p_approve && r.contact_email) {
          invite = code().slice(0, 16);
          db.tree_invites.push({ code: invite, tree_id: 'demo', role: 'viewer', email: r.contact_email, branch_person_id: null, can_add: true, can_edit: true, can_delete: false, can_grant: false, enabled: true, uses: 0, max_uses: 1, created_at: String(Date.now()) });
          r.invite_code = invite;
        }
        return { data: { doc_path: r.doc_path, invite_code: invite }, error: null };
      }
      if (name === 'claim_join_invite') {
        const r = db.join_requests.find((x) => x.track_code === a.p_code);
        const mail = String(a.p_email || '').trim().toLowerCase();
        if (!r || r.status !== 'approved' || (r.contact_email && !r.invite_claimed)) return { data: null, error: { message: 'request not found' } };
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { data: null, error: { message: 'invalid email' } };
        const old = r.invite_code && db.tree_invites.find((i) => i.code === r.invite_code);
        if (old && old.uses >= old.max_uses) return { data: null, error: { message: 'invite already used' } };
        if (old) old.enabled = false;
        const invite = code().slice(0, 16);
        db.tree_invites.push({ code: invite, tree_id: 'demo', role: 'viewer', email: mail, branch_person_id: null, can_add: true, can_edit: true, can_delete: false, can_grant: false, enabled: true, uses: 0, max_uses: 1, created_at: String(Date.now()) });
        r.invite_code = invite;
        r.contact_email = mail;
        r.invite_claimed = true;
        return { data: invite, error: null };
      }
      if (name === 'forget_join_doc') {
        const r = db.join_requests.find((x) => x.id === a.p_id);
        if (r && r.status !== 'pending') r.doc_path = null;
        return { data: null, error: null };
      }
      if (name === 'report_card_error') {
        db.card_reports.unshift({ id: 'n' + Math.random().toString(16).slice(2, 8), tree_id: 'demo', person_id: a.p_person, user_id: userId, message: a.p_message, status: 'open', created_at: new Date().toISOString(), resolution_note: null });
        return { data: 'new', error: null };
      }
      if (name === 'request_branch_access') {
        if (db.access_requests.some((r) => r.user_id === userId && r.person_id === a.p_person && r.status === 'pending')) return { data: null, error: { message: 'duplicate key value violates unique constraint "access_requests_one_pending"' } };
        db.access_requests.unshift({ id: 'n' + Math.random().toString(16).slice(2, 8), tree_id: 'demo', person_id: a.p_person, user_id: userId, can_add: !!a.p_add, can_edit: !!a.p_edit, can_delete: !!a.p_delete, message: a.p_message || null, status: 'pending', created_at: new Date().toISOString(), decided_by: null, decision_note: null });
        return { data: 'new', error: null };
      }
      if (name === 'decide_access_request') {
        const r = db.access_requests.find((x) => x.id === a.p_id);
        if (!r || r.status !== 'pending') return { data: null, error: { message: 'request already decided' } };
        r.status = a.p_approve ? 'approved' : 'rejected';
        r.decision_note = a.p_note || null;
        if (a.p_approve) db.branch_grants.push({ tree_id: 'demo', user_id: r.user_id, person_id: r.person_id, can_add: a.p_add, can_edit: a.p_edit, can_delete: a.p_delete, can_grant: a.p_grant, created_by: userId });
        return { data: null, error: null };
      }
      if (name === 'cancel_access_request') {
        const r = db.access_requests.find((x) => x.id === a.p_id && x.user_id === userId && x.status === 'pending');
        if (!r) return { data: null, error: { message: 'nothing to cancel' } };
        r.status = 'cancelled';
        return { data: null, error: null };
      }
      if (name === 'set_report_status') {
        const r = db.card_reports.find((x) => x.id === a.p_id);
        if (r) r.status = a.p_status;
        return { data: null, error: null };
      }
      if (name === 'revert_change') {
        const anchor = db.change_log.find((r) => r.id === a.p_log_id);
        if (!anchor) return { data: null, error: { message: 'change not found' } };
        const n = db.change_log.filter((r) => r.txid === anchor.txid).length;
        db.change_log = db.change_log.filter((r) => r.txid !== anchor.txid);
        return { data: n, error: null };
      }
      return { data: null, error: { message: `demo: ${name} is not simulated` } };
    },
  };
}

export const demoMarriages = [
  { id: 'dm1', tree_id: 'demo', person_a: 'g', person_b: 'w1', status: 'widowed', marriage_date: '1938', created_at: '0001' },
  { id: 'dm2', tree_id: 'demo', person_a: 'g', person_b: 'w2', status: 'married', marriage_date: '1950', created_at: '0002' },
  { id: 'dm3', tree_id: 'demo', person_a: 'b', person_b: 'bh', status: 'married', marriage_date: '1964', created_at: '0003' },
];
