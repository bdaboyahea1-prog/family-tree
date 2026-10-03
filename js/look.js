// The look of the tree (how it is drawn), kept apart from the data of the family.
//
//   factory   what the program starts with                                                 (FACTORY_LOOK)
//   default   what the tree admin chose for everybody; stored with the tree in the database  (trees.default_look)
//   mine      what one member chose for themselves only; stored with their profile          (profiles.look)
//
// A member sees: factory <- default <- mine. A key that a member never touched follows the default, so when the admin
// changes the default, everybody who did not choose for themselves gets it. The admin has no "mine": whatever
// the admin changes becomes the default of the tree. Only keys listed here, with allowed values, are ever kept.
import { isCardStyle } from './cardstyles.js';

const bool = (v) => typeof v === 'boolean';

const RULES = {
  design: (v) => ['classic', 'horizontal', 'fan', 'tree'].includes(v), // the shape of the tree
  cardStyle: (v) => isCardStyle(v), // the look of a card
  theme: (v) => ['auto', 'light', 'dark'].includes(v), // the colours: light / dark / follow the device
  branchColors: bool, // every branch in its own colour
  bands: bool, // a band behind each generation
  showWives: bool, // the wives written under the husband's card
  showYears: bool, // birth and death years
  curves: bool, // curved connectors
  cardButtons: bool, // the "إضافة" and "عرض" buttons on every card
  showFemales: bool, // women's cards in the tree (off = the male line only)
  wifeColors: bool, // a man with several wives: a circle in a colour by each wife, the same colour on her children
  tripleName: bool, // the name on a card: first name + father's name + family
};

export const LOOK_KEYS = Object.keys(RULES);

export const FACTORY_LOOK = Object.freeze({
  design: 'classic',
  cardStyle: 'portrait',
  theme: 'auto',
  branchColors: true,
  bands: false,
  showWives: true,
  showYears: true,
  curves: true,
  cardButtons: true,
  showFemales: true,
  wifeColors: true,
  tripleName: true,
});

/** Only the known keys with allowed values; anything else (also from an old or damaged record) is dropped. */
export function cleanLook(x) {
  const out = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  for (const k of LOOK_KEYS) if (Object.hasOwn(x, k) && RULES[k](x[k])) out[k] = x[k];
  return out;
}

/** The look a member sees. */
export const resolveLook = (treeDefault, mine) => ({ ...FACTORY_LOOK, ...cleanLook(treeDefault), ...cleanLook(mine) });

/** The choices of an older version, kept in the browser one by one (ft.design, ft.wives …): one object, valid keys only. */
export function legacyLook(get) {
  const flag = (key) => (get(key) === '1' ? true : get(key) === '0' ? false : undefined);
  const raw = {
    design: get('ft.design'),
    cardStyle: get('ft.cardstyle'),
    theme: get('ft.theme'),
    showWives: flag('ft.wives'),
    showYears: flag('ft.years'),
    branchColors: flag('ft.branches'),
    bands: flag('ft.bands'),
    curves: flag('ft.curves'),
    cardButtons: flag('ft.cardbtn'),
  };
  if (raw.design === 'bands') raw.design = 'classic'; // generation bands used to be a design of their own
  return cleanLook(raw);
}
