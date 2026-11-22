// WCAG contrast gate for token pairs (v3). Usage: node design/check-contrast.cjs [--verbose] (exit 1 on failure)
// Supports #RRGGBB and rgba(); translucent colours (glass) are alpha-composited over each worst-case backdrop first.
const t = require('./tokens.json');
const verbose = process.argv.includes('--verbose');
const parse = s => {
  s = String(s).trim();
  if (s[0] === '#') return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16), a: 1 };
  const m = s.match(/rgba?\(([^)]+)\)/); const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
};
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const lum = c => { const v = [c.r, c.g, c.b].map(x => x / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
// A colour spec: token name, or "token@backdrop" = token composited over backdrop token (for translucent tokens).
const get = (mode, spec) => {
  const [tok, back] = spec.split('@'); let c = parse(t.color[mode][tok].value);
  if (c.a < 1) c = over(c, parse(t.color[mode][back || 'bg'].value));
  return c;
};
// [fg, bg, min]: 4.5 text, 3 non-text / large text.
// Note: the focus ring is drawn with a 2px offset, so it is measured against the page/surface behind it, not against the control it surrounds.
const TEXT = 4.5, UI = 3;
const base = [
  ['text','bg',TEXT],['text','surface',TEXT],['text','surface-raised',TEXT],['text','bg-subtle',TEXT],['text-muted','bg',TEXT],['text-muted','surface',TEXT],['text-muted','surface-raised',TEXT],['text-muted','bg-subtle',TEXT],
  ['on-primary','primary',TEXT],['on-primary','primary-hover',TEXT],['link','bg',TEXT],['link','surface',TEXT],['link','bg-subtle',TEXT],['link','surface-raised',TEXT],
  ['primary','bg',TEXT],['primary','surface',TEXT],['primary-hover','bg',TEXT],
  ['on-primary-subtle','primary-subtle',TEXT],['text','primary-subtle',TEXT],
  ['on-accent','accent',TEXT],['on-accent','accent-hover',TEXT],['accent','bg',TEXT],['accent','surface',TEXT],['on-accent-subtle','accent-subtle',TEXT],
  ['success','success-bg',TEXT],['warning','warning-bg',TEXT],['danger','danger-bg',TEXT],['info','info-bg',TEXT],
  ['success','bg',TEXT],['verified','surface',TEXT],['verified','bg-subtle',TEXT],['danger','bg',TEXT],['danger','surface',TEXT],
  ['on-brand','brand-from',TEXT],['on-brand','brand-via',TEXT],['on-brand','brand-to',TEXT],
  ['star','bg',UI],['star','surface',UI],['star-empty','bg',UI],['star-empty','surface',UI],['border-strong','bg',UI],['border-strong','surface',UI],['border-strong','surface-raised',UI],['border-strong','bg-subtle',UI],
  ['focus','bg',UI],['focus','surface',UI],['focus','bg-subtle',UI],['focus','surface-raised',UI],
  ['primary','bg',UI],['accent','surface',UI],
];
// Glass: text/muted/link/focus/border-strong on glass composited over every plausible backdrop (page bg and the 3 gradient stops).
const backs = ['bg','bg-subtle','brand-from','brand-via','brand-to'];
const glass = [];
for (const g of ['glass','glass-strong']) for (const b of backs) {
  glass.push([['text',`${g}@${b}`,TEXT],['text-muted',`${g}@${b}`,TEXT],['link',`${g}@${b}`,TEXT],['focus',`${g}@${b}`,UI],['border-strong',`${g}@${b}`,UI]]);
}
// Hero mesh tint (primary 20% over bg) and brand-soft are the lightest/darkest decorative backgrounds text may sit on.
const tints = { light: ['primary','accent'], dark: ['primary','accent'] };
let bad = 0, total = 0; const rows = [];
const check = (mode, f, b, min) => {
  total++;
  const r = ratio(get(mode, f), get(mode, b));
  const ok = r >= min; if (!ok) bad++;
  rows.push(`${ok ? 'ok  ' : 'FAIL'} ${mode.padEnd(5)} ${f} on ${b}: ${r.toFixed(2)} (min ${min})`);
};
for (const mode of ['light', 'dark']) {
  for (const [f, b, m] of base) check(mode, f, b, m);
  for (const grp of glass) for (const [f, b, m] of grp) check(mode, f, b, m);
  for (const tint of tints[mode]) { // hero mesh: 20% tint of primary/accent over bg
    const k = `__mesh_${tint}`; const c = over({ ...parse(t.color[mode][tint].value), a: .2 }, parse(t.color[mode].bg.value));
    t.color[mode][k] = { value: `rgb(${c.r}, ${c.g}, ${c.b})` };
    for (const f of ['text','text-muted','link']) check(mode, f, k, TEXT);
  }
}
if (verbose || bad) console.log(rows.filter(r => verbose || r.startsWith('FAIL')).join('\n'));
const min = rows.map(r => parseFloat(r.match(/: ([\d.]+) /)[1])).reduce((a, b) => Math.min(a, b));
console.log(bad ? `${bad} failures of ${total}` : `all ${total} pairs pass (light + dark, incl. glass over 5 backdrops and hero mesh tints); lowest ratio ${min.toFixed(2)}`);
process.exit(bad ? 1 : 0);
