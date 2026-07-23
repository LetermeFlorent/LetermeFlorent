// Genere automatiquement les sections dynamiques du README de profil.
// Source de verite = API GitHub (aucun contenu hardcode) :
//   - langues reellement utilisees (agregation des bytes de tous les repos owner non-fork)
//   - stack (icones deduites des langues detectees)
//   - chiffres (repos publics, etoiles cumulees, langue principale)
//   - activite recente (evenements publics)
// Injecte entre les marqueurs <!--START_SECTION:x--> / <!--END_SECTION:x-->.
// Ne depend d'aucun service de rendu tiers instable : uniquement img.shields.io
// et skillicons.dev (fiables), le reste est du texte/markdown.

const fs = require('fs');
const path = require('path');

const USER = process.env.PROFILE_USER || 'LetermeFlorent';
const TOKEN = process.env.GITHUB_TOKEN;
const README = path.join(process.cwd(), 'README.md');
const TOP_LANGS = 8;
const MAX_ACTIVITY = 6;

if (!TOKEN) { console.error('GITHUB_TOKEN manquant'); process.exit(1); }

const HEADERS = {
  'Authorization': 'bearer ' + TOKEN,
  'User-Agent': USER + '-profile-bot',
  'Accept': 'application/vnd.github+json',
};

// Metadonnees d'affichage par langue. Inconnu -> badge gris sans logo, pas d'icone.
const LANG = {
  PHP:        { color: '777BB4', logo: 'php',        lc: 'white', sk: 'php' },
  JavaScript: { color: 'F7DF1E', logo: 'javascript', lc: 'black', sk: 'js' },
  TypeScript: { color: '3178C6', logo: 'typescript', lc: 'white', sk: 'ts' },
  CSS:        { color: '1572B6', logo: 'css3',       lc: 'white', sk: 'css' },
  Python:     { color: '3776AB', logo: 'python',     lc: 'white', sk: 'python' },
  HTML:       { color: 'E34F26', logo: 'html5',      lc: 'white', sk: 'html' },
  Rust:       { color: '000000', logo: 'rust',       lc: 'white', sk: 'rust' },
  Java:       { color: 'ED8B00', logo: 'openjdk',    lc: 'white', sk: 'java' },
  Twig:       { color: '8CB92A', logo: 'twig',       lc: 'white', sk: null },
  Shell:      { color: '4EAA25', logo: 'gnubash',    lc: 'white', sk: 'bash' },
  Dockerfile: { color: '2496ED', logo: 'docker',     lc: 'white', sk: 'docker' },
  Batchfile:  { color: '555555', logo: null,         lc: 'white', sk: null },
  Vue:        { color: '4FC08D', logo: 'vuedotjs',   lc: 'white', sk: 'vue' },
  Go:         { color: '00ADD8', logo: 'go',         lc: 'white', sk: 'go' },
  'C#':       { color: '512BD4', logo: 'csharp',     lc: 'white', sk: 'cs' },
  'C++':      { color: '00599C', logo: 'cplusplus',  lc: 'white', sk: 'cpp' },
  C:          { color: 'A8B9CC', logo: 'c',          lc: 'black', sk: 'c' },
  Ruby:       { color: 'CC342D', logo: 'ruby',       lc: 'white', sk: 'ruby' },
  Kotlin:     { color: '7F52FF', logo: 'kotlin',     lc: 'white', sk: 'kotlin' },
  Svelte:     { color: 'FF3E00', logo: 'svelte',     lc: 'white', sk: 'svelte' },
};

async function gql(query, variables) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error('GraphQL HTTP ' + r.status + ' ' + (await r.text()));
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors));
  return j.data;
}

async function fetchRepos() {
  const query = `query($login:String!,$after:String){
    user(login:$login){
      repositories(first:100,after:$after,ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC){
        pageInfo{hasNextPage endCursor}
        nodes{ name stargazerCount languages(first:25){edges{size node{name}}} }
      }
    }
  }`;
  let after = null, nodes = [];
  do {
    const data = await gql(query, { login: USER, after });
    const repo = data.user.repositories;
    nodes = nodes.concat(repo.nodes);
    after = repo.pageInfo.hasNextPage ? repo.pageInfo.endCursor : null;
  } while (after);
  return nodes;
}

function aggregateLanguages(repos) {
  const agg = {};
  let stars = 0;
  for (const repo of repos) {
    stars += repo.stargazerCount;
    for (const e of repo.languages.edges) {
      agg[e.node.name] = (agg[e.node.name] || 0) + e.size;
    }
  }
  const total = Object.values(agg).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(agg)
    .map(([name, size]) => ({ name, size, pct: (size / total) * 100 }))
    .sort((a, b) => b.size - a.size);
  return { sorted, stars, repoCount: repos.length };
}

function badge(label, message, color, logo, lc) {
  const enc = (s) => encodeURIComponent(String(s).replace(/-/g, '--').replace(/_/g, '__'));
  let url = `https://img.shields.io/badge/${enc(label)}-${enc(message)}-${color}?style=for-the-badge`;
  if (logo) url += `&logo=${logo}&logoColor=${lc || 'white'}`;
  return url;
}

function buildStack(sorted) {
  const top = sorted.slice(0, TOP_LANGS);
  const slugs = [];
  for (const l of top) {
    const m = LANG[l.name];
    if (m && m.sk && slugs.indexOf(m.sk) === -1) slugs.push(m.sk);
  }
  const lines = [];
  if (slugs.length) {
    lines.push('<div align="center">');
    lines.push(`  <img src="https://skillicons.dev/icons?i=${slugs.join(',')}&perline=10" alt="Stack" />`);
    lines.push('</div>');
    lines.push('');
  }
  lines.push('<div align="center">');
  lines.push('');
  for (const l of top) {
    const m = LANG[l.name] || { color: '6E7681', logo: null, lc: 'white' };
    const pct = l.pct >= 1 ? l.pct.toFixed(1) : l.pct.toFixed(2);
    lines.push(`  ![${l.name}](${badge(l.name, pct + '%', m.color, m.logo, m.lc)})`);
  }
  lines.push('');
  lines.push('</div>');
  return lines.join('\n');
}

function buildStats(stats) {
  const top = stats.sorted[0] ? stats.sorted[0].name : '—';
  const b = [
    ['Repos_publics', String(stats.repoCount), '6C5CE7', 'github'],
    ['Etoiles', String(stats.stars), 'F1C40F', 'github'],
    ['Langue_principale', top, '00B894', null],
    ['Langues', String(stats.sorted.length), '0984E3', null],
  ];
  const out = ['<div align="center">', ''];
  for (const [l, m, c, logo] of b) {
    out.push(`  ![${l}](${badge(l, m, c, logo, 'white')})`);
  }
  out.push('', '</div>');
  return out.join('\n');
}

async function fetchActivity() {
  const r = await fetch(`https://api.github.com/users/${USER}/events/public?per_page=100`, { headers: HEADERS });
  if (!r.ok) return '';
  const events = await r.json();
  const emoji = {
    PushEvent: '⬆️', PullRequestEvent: '🔀', IssuesEvent: '🐛',
    IssueCommentEvent: '💬', ReleaseEvent: '🚀', CreateEvent: '✨',
    ForkEvent: '🍴', WatchEvent: '⭐', DeleteEvent: '🗑️',
  };
  const seen = new Set(), lines = [];
  for (const ev of events) {
    if (!emoji[ev.type]) continue;
    const repo = ev.repo.name;
    let text;
    switch (ev.type) {
      case 'PushEvent': {
        const n = (ev.payload && ev.payload.commits ? ev.payload.commits.length : 1);
        text = `${n} commit${n > 1 ? 's' : ''} poussé${n > 1 ? 's' : ''} sur`;
        break;
      }
      case 'PullRequestEvent': text = `PR ${ev.payload.action} sur`; break;
      case 'IssuesEvent':      text = `issue ${ev.payload.action} sur`; break;
      case 'IssueCommentEvent':text = 'commentaire sur'; break;
      case 'ReleaseEvent':     text = `release publiée sur`; break;
      case 'CreateEvent':      text = `${ev.payload.ref_type} créé sur`; break;
      case 'ForkEvent':        text = 'fork de'; break;
      case 'WatchEvent':       text = 'étoile sur'; break;
      case 'DeleteEvent':      text = `${ev.payload.ref_type} supprimé sur`; break;
      default: continue;
    }
    const key = ev.type + '|' + repo + '|' + text;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${emoji[ev.type]} ${text} [${repo}](https://github.com/${repo})`);
    if (lines.length >= MAX_ACTIVITY) break;
  }
  return lines.length ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n') : '_Aucune activité publique récente._';
}

function inject(content, section, body) {
  const start = `<!--START_SECTION:${section}-->`;
  const end = `<!--END_SECTION:${section}-->`;
  const re = new RegExp(start + '[\\s\\S]*?' + end);
  if (!re.test(content)) { console.warn('marqueur absent: ' + section); return content; }
  return content.replace(re, `${start}\n${body}\n${end}`);
}

(async () => {
  const repos = await fetchRepos();
  const stats = aggregateLanguages(repos);
  let md = fs.readFileSync(README, 'utf8');
  md = inject(md, 'stack', buildStack(stats.sorted));
  md = inject(md, 'stats', buildStats(stats));
  md = inject(md, 'activity', await fetchActivity());
  fs.writeFileSync(README, md);
  console.log('OK — langues:', stats.sorted.slice(0, TOP_LANGS).map(l => `${l.name} ${l.pct.toFixed(1)}%`).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
