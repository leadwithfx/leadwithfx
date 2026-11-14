// Dependency-free Markdown for Insights posts. Supports: front matter, # ## ### headings, paragraphs,
// bullet and numbered lists, blockquotes, fenced code, **bold**, *italic*, `code`, [links](url), ---.
export const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function parseFront(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error("missing front matter");
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = line.match(/^([a-z]+):\s*(.*)$/i);
    if (!k) continue;
    let v = k[2].trim().replace(/^"(.*)"$/, "$1");
    if (k[1] === "tags") meta.tags = v.replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean);
    else if (k[1] === "draft") meta.draft = v === "true";
    else meta[k[1]] = v;
  }
  return { meta, body: m[2] };
}

function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, t, u) => {
    if (/^(javascript|data):/i.test(u)) return t;
    const ext = /^https?:/i.test(u);
    return '<a href="' + u + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + t + "</a>";
  });
  return s;
}

export function mdToHtml(md) {
  const lines = md.replace(/\r/g, "").split("\n"), out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if (/^```/.test(l)) { const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>"); continue; }
    if ((m = l.match(/^(#{2,3})\s+(.*)$/))) { out.push("<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">"); i++; continue; }
    if (/^---+$/.test(l.trim())) { out.push("<hr>"); i++; continue; }
    if (/^>\s?/.test(l)) { const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, "")); out.push("<blockquote><p>" + inline(q.join(" ")) + "</p></blockquote>"); continue; }
    if (/^[-*]\s+/.test(l)) { const it = []; while (i < lines.length && /^[-*]\s+/.test(lines[i])) it.push("<li>" + inline(lines[i++].replace(/^[-*]\s+/, "")) + "</li>"); out.push("<ul>" + it.join("") + "</ul>"); continue; }
    if (/^\d+\.\s+/.test(l)) { const it = []; while (i < lines.length && /^\d+\.\s+/.test(lines[i])) it.push("<li>" + inline(lines[i++].replace(/^\d+\.\s+/, "")) + "</li>"); out.push("<ol>" + it.join("") + "</ol>"); continue; }
    const p = []; while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|```|>|[-*]\s|\d+\.\s|---+$)/.test(lines[i])) p.push(lines[i++].trim());
    out.push("<p>" + inline(p.join(" ")) + "</p>");
  }
  return out.join("\n");
}

export const plain = (md) => md.replace(/```[\s\S]*?```/g, " ").replace(/[#>*`_\[\]()-]/g, " ").replace(/\s+/g, " ").trim();
export const readMins = (md) => Math.max(1, Math.round(plain(md).split(" ").length / 220));
export const fmtDate = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const slugOf = (name) => name.replace(/\.md$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
