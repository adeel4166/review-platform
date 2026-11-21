/**
 * Minimal HTML tokenizer that extracts `<meta name="rp-verify" content="...">` from the document head (M3 spec §5.4).
 * It is not a regex over the whole document: comments, <script>/<style>/<title>/<textarea> bodies and quoted attribute
 * values are skipped, so a token hidden in a comment or script never counts. Scanning stops at <body> or </head>.
 */
const RAW_TEXT = new Set(["script", "style", "title", "textarea", "noscript"]);

export function extractMetaTokens(html: string, name = "rp-verify", limit = 5): string[] {
  const out: string[] = [];
  const s = html.length > 1_048_576 ? html.slice(0, 1_048_576) : html;
  let i = 0;
  while (i < s.length && out.length < limit) {
    const lt = s.indexOf("<", i);
    if (lt < 0) break;
    if (s.startsWith("<!--", lt)) { const e = s.indexOf("-->", lt + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s[lt + 1] === "!" || s[lt + 1] === "?") { const e = s.indexOf(">", lt); i = e < 0 ? s.length : e + 1; continue; }
    const closing = s[lt + 1] === "/";
    const m = /^<\/?([a-zA-Z][a-zA-Z0-9:-]*)/.exec(s.slice(lt, lt + 64));
    if (!m) { i = lt + 1; continue; }
    const tag = m[1]!.toLowerCase();
    // read attributes up to the closing '>' honouring quotes
    let j = lt + m[0].length;
    const attrs: Record<string, string> = {};
    for (;;) {
      while (j < s.length && /[\s/]/.test(s[j]!)) j++;
      if (j >= s.length) break;
      if (s[j] === ">") { j++; break; }
      const nm = /^[^\s=>/]+/.exec(s.slice(j, j + 200));
      if (!nm) { j++; continue; }
      j += nm[0].length;
      while (j < s.length && /\s/.test(s[j]!)) j++;
      let val = "";
      if (s[j] === "=") {
        j++;
        while (j < s.length && /\s/.test(s[j]!)) j++;
        const q = s[j];
        if (q === '"' || q === "'") { const e = s.indexOf(q, j + 1); val = s.slice(j + 1, e < 0 ? s.length : e); j = e < 0 ? s.length : e + 1; }
        else { const v = /^[^\s>]*/.exec(s.slice(j, j + 2000))!; val = v[0]; j += v[0].length; }
      }
      const key = nm[0].toLowerCase();
      if (!(key in attrs)) attrs[key] = val;
    }
    i = j;
    if (!closing && tag === "body") break;
    if (closing && tag === "head") break;
    if (!closing && tag === "meta" && attrs.name?.trim().toLowerCase() === name && attrs.content !== undefined) out.push(attrs.content.trim().slice(0, 128));
    if (!closing && RAW_TEXT.has(tag)) { const e = s.toLowerCase().indexOf(`</${tag}`, i); i = e < 0 ? s.length : e; }
  }
  return out;
}
