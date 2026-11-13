// Builds assets/stats.svg: public GitHub stats as terminal output, in the same style as terminal.svg.
// Runs in the "stats" workflow every day (GITHUB_TOKEN), no third-party service.
import { writeFileSync, mkdirSync } from "node:fs";

const USER = process.env.STATS_USER || "xovaaan";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-stats" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// Public, non-fork repositories the user owns (all pages).
let repos = [], after = null, user;
do {
  const d = await gql(
    `query($login:String!,$after:String){ user(login:$login){
      followers{totalCount}
      contributionsCollection{ contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } }
      repositories(first:100, after:$after, privacy:PUBLIC, ownerAffiliations:OWNER, isFork:false){
        pageInfo{hasNextPage endCursor}
        nodes{ stargazerCount languages(first:10, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name color } } } }
      } } }`,
    { login: USER, after },
  );
  user = d.user;
  repos = repos.concat(user.repositories.nodes);
  after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
} while (after);

const stars = repos.reduce((n, r) => n + r.stargazerCount, 0);
const cal = user.contributionsCollection.contributionCalendar;
const days = cal.weeks.flatMap((w) => w.contributionDays);
// Current streak: consecutive days with contributions, ending today or yesterday.
let streak = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) streak++;
  else if (i === days.length - 1) continue; // today may still be empty
  else break;
}
let best = 0, run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; best = Math.max(best, run); }

// Markup, not code: generated HTML pages would otherwise outweigh everything else.
const EXCLUDE = new Set(["HTML"]);
const langs = new Map();
for (const r of repos) for (const e of r.languages.edges) {
  if (EXCLUDE.has(e.node.name)) continue;
  const cur = langs.get(e.node.name) || { size: 0, color: e.node.color || "#8b949e" };
  cur.size += e.size; langs.set(e.node.name, cur);
}
const total = [...langs.values()].reduce((n, l) => n + l.size, 0) || 1;
const top = [...langs.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 5)
  .map(([name, l]) => ({ name, color: l.color, pct: (l.size / total) * 100 }));

// ---- draw ----
const W = 860, PAD = 28, CW = 8.4, FS = 14, LH = 24;
const C = { panel: "#0d1117", border: "#232a33", bar: "#11161d", text: "#c9d1d9", dim: "#6e7681", green: "#56d364", blue: "#58a6ff", amber: "#e3b341" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => n.toLocaleString("en-US");
let y = 68, t = 0.3, body = "";
const line = (parts, x0 = PAD) => {
  let x = x0, out = "";
  for (const [s, color] of parts) {
    out += `<text x="${x}" y="${y}" fill="${color}" textLength="${(s.length * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${esc(s)}</text>`;
    x += s.length * CW;
  }
  body += `<g opacity="0"><set attributeName="opacity" to="1" begin="${t.toFixed(2)}s" fill="freeze"/>${out}</g>`;
  y += LH; t += 0.18;
};
line([["samiul", C.green], ["@", C.dim], ["formzed", C.blue], [":~$ ", C.dim], [`gh stats --user ${USER}`, C.text]]);
y += 4;
const row = (k, v, note = "") => line([[k.padEnd(22, " "), C.dim], [v, C.amber], [note ? `  ${note}` : "", C.dim]]);
row("contributions", fmt(cal.totalContributions), "last 12 months");
row("current streak", `${streak} day${streak === 1 ? "" : "s"}`, `best ${best}`);
row("public repos", fmt(repos.length), "non-fork");
row("stars earned", fmt(stars));
row("followers", fmt(user.followers.totalCount));
y += 8;
line([["top languages", C.dim]]);
// stacked language bar, 2px gaps between segments
const barX = PAD, barW = W - PAD * 2, barY = y - 8;
let x = barX, segs = "";
for (const l of top) {
  const w = Math.max(2, (l.pct / 100) * barW - 2);
  segs += `<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="8" rx="2" fill="${l.color}"/>`;
  x += w + 2;
}
body += `<g opacity="0"><set attributeName="opacity" to="1" begin="${t.toFixed(2)}s" fill="freeze"/>${segs}</g>`;
y += 22; t += 0.18;
let lx = PAD, legend = "";
for (const l of top) {
  const label = `${l.name} ${l.pct.toFixed(1)}%`;
  legend += `<rect x="${lx}" y="${y - 10}" width="9" height="9" rx="2" fill="${l.color}"/><text x="${lx + 15}" y="${y}" fill="${C.text}" xml:space="preserve">${esc(label)}</text>`;
  lx += 15 + label.length * CW + 22;
}
body += `<g opacity="0"><set attributeName="opacity" to="1" begin="${t.toFixed(2)}s" fill="freeze"/>${legend}</g>`;
y += LH;
const H = y + 18;
const updated = new Date().toISOString().slice(0, 10);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub stats for ${USER}: ${cal.totalContributions} contributions in the last year, ${repos.length} public repos, ${stars} stars, ${user.followers.totalCount} followers. Top language ${top[0]?.name ?? ""}.">
<title>GitHub stats · ${USER} · updated ${updated}</title>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${C.panel}" stroke="${C.border}"/>
<path d="M13 1H${W - 13}A12 12 0 0 1 ${W - 1} 13V38H1V13A12 12 0 0 1 13 1Z" fill="${C.bar}"/>
<path d="M1 38H${W - 1}" stroke="${C.border}"/>
<circle cx="24" cy="19.5" r="6" fill="#ff5f57"/><circle cx="44" cy="19.5" r="6" fill="#febc2e"/><circle cx="64" cy="19.5" r="6" fill="#28c840"/>
<g font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace" font-size="${FS}">
<text x="${W / 2}" y="24" fill="${C.dim}" font-size="12.5" text-anchor="middle">gh stats · updated ${updated}</text>
${body}
</g>
</svg>
`;
mkdirSync("assets", { recursive: true });
writeFileSync("assets/stats.svg", svg);
console.log({ contributions: cal.totalContributions, streak, best, repos: repos.length, stars, followers: user.followers.totalCount, top: top.map((l) => `${l.name} ${l.pct.toFixed(1)}%`) });
