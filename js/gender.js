// The little figure shown in place of a photo: a man or a woman (instead of the first letter of the name).
// Drawn in the colour of the card (currentColor), so it follows the light / dark theme and the gender colours.
const SVGNS = 'http://www.w3.org/2000/svg';

const SHAPES = {
  // a head and straight shoulders
  male: ['<circle cx="12" cy="6.4" r="3.6"/>', '<path d="M6.4 21v-5.6c0-2 1.6-3.6 3.6-3.6h4c2 0 3.6 1.6 3.6 3.6V21z"/>'],
  // a head and a dress
  female: ['<circle cx="12" cy="6.2" r="3.4"/>', '<path d="M12 11c-1.9 0-3 1.1-3.6 2.7L5.7 21h12.6l-2.7-7.3C15 12.1 13.9 11 12 11z"/>'],
};

/** An <svg> element for 'male' or 'female' (anything else is drawn as a man). */
export function genderIcon(gender) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'gender-icon');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('fill', 'currentColor');
  s.innerHTML = (SHAPES[gender] || SHAPES.male).join('');
  return s;
}
