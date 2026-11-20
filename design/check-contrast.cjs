// WCAG contrast gate for token pairs. Usage: node design/check-contrast.cjs (exit 1 on failure)
const t = require('./tokens.json');
const lum = h => { const c = [1,3,5].map(i => parseInt(h.slice(i, i+2), 16)/255).map(v => v <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4); return .2126*c[0]+.7152*c[1]+.0722*c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x+.05)/(y+.05); };
// [fg, bg, min ratio]: 4.5 text, 3 non-text/large
const pairs = [
  ['text','bg',4.5],['text','surface',4.5],['text','bg-subtle',4.5],['text-muted','bg',4.5],['text-muted','surface',4.5],['text-muted','bg-subtle',4.5],
  ['on-primary','primary',4.5],['on-primary','primary-hover',4.5],['link','bg',4.5],['link','surface',4.5],
  ['success','success-bg',4.5],['warning','warning-bg',4.5],['danger','danger-bg',4.5],['info','info-bg',4.5],
  ['success','bg',4.5],['verified','surface',4.5],['danger','bg',4.5],['danger','surface',4.5],
  ['focus','bg',3],['focus','surface',3],['star','bg',3],['star-empty','bg',3],['border-strong','bg',3],['border-strong','surface',3],['primary','bg',3],
];
let bad = 0;
for (const mode of ['light','dark']) for (const [f,b,min] of pairs) {
  const r = ratio(t.color[mode][f].value, t.color[mode][b].value);
  if (r < min) { bad++; console.log(`FAIL ${mode} ${f} on ${b}: ${r.toFixed(2)} < ${min}`); }
}
console.log(bad ? `${bad} failures` : `all ${pairs.length*2} pairs pass`);
process.exit(bad ? 1 : 0);
