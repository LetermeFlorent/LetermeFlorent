// Genere automatiquement les sections dynamiques du README de profil.
// Source de verite = API GitHub (aucun contenu hardcode) :
//   - langues reellement utilisees (agregation des bytes de tous les repos owner non-fork)
//   - activite recente (evenements publics)
// Injecte entre les marqueurs <!--START_SECTION:x--> / <!--END_SECTION:x-->.
// Tout est du texte markdown, sans service de rendu tiers.

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

function buildStack(sorted) {
  const top = sorted.slice(0, TOP_LANGS)
    .filter(l => l.pct >= 1)
    .map(l => `${l.name} ${Math.round(l.pct)} %`);
  return `Répartition du code sur mes dépôts publics : ${top.join(', ')}.`;
}

async function fetchActivity() {
  const r = await fetch(`https://api.github.com/users/${USER}/events/public?per_page=100`, { headers: HEADERS });
  if (!r.ok) return '';
  const events = await r.json();
  const kinds = new Set(['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'IssueCommentEvent',
    'ReleaseEvent', 'CreateEvent', 'ForkEvent']);
  const seen = new Set(), lines = [];
  for (const ev of events) {
    if (!kinds.has(ev.type)) continue;
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
      case 'CreateEvent':
        text = { branch: 'branche créée sur', tag: 'tag créé sur' }[ev.payload.ref_type] || 'dépôt créé :';
        break;
      case 'ForkEvent':        text = 'fork de'; break;
      default: continue;
    }
    const key = ev.type + '|' + repo + '|' + text;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${text[0].toUpperCase() + text.slice(1)} [${repo}](https://github.com/${repo})`);
    if (lines.length >= MAX_ACTIVITY) break;
  }
  return lines.length ? lines.map(l => `- ${l}`).join('\n') : 'Aucune activité publique récente.';
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
  md = inject(md, 'activity', await fetchActivity());
  fs.writeFileSync(README, md);
  console.log('OK, langues :', stats.sorted.slice(0, TOP_LANGS).map(l => `${l.name} ${l.pct.toFixed(1)}%`).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
