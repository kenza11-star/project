// Pemeriksaan statis: rahasia tidak boleh bocor ke frontend. Dijalankan oleh `npm run check:secrets` dan test:backend.
// 1) Kode klien (app/**/*.tsx, components, lib/** kecuali lib/server) tidak boleh mengimpor lib/server, firebase-admin, atau menyebut variabel rahasia.
// 2) Tidak ada variabel NEXT_PUBLIC_* yang namanya mengandung SECRET/PRIVATE/SERVICE_ROLE/ADMIN.
// 3) .env.example tidak berisi nilai (hanya nama variabel) dan semua variabel yang dipakai kode terdaftar di sana.
// 4) Tidak ada kunci/private key/JWT yang ter-hardcode di repo (pola umum).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let fails = 0; const bad = (m) => { fails++; console.log('  GAGAL:', m); };
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.next', '.tmp-game', '.tmp-ui', '.tmp-net', '.tmp-backend', '.git', 'public', 'scripts'].includes(e.name)) continue; const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : /\.(ts|tsx|js|jsx|mjs|json|css|md|sql)$/.test(e.name) && out.push(p); } return out; };
const files = walk(root);
const rel = (f) => path.relative(root, f).split(path.sep).join('/');
const isServer = (f) => rel(f).startsWith('lib/server/') || rel(f).startsWith('app/api/');
const code = files.filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));
const isClientDir = (f) => /^(app|components|lib)\//.test(rel(f)); // next.config.js dkk. bukan kode klien

const SECRET_NAMES = /FIREBASE_PRIVATE_KEY|FIREBASE_CLIENT_EMAIL|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE/;
let n = 0;
for (const f of code) {
  const s = fs.readFileSync(f, 'utf8'); n++;
  if (!isServer(f) && isClientDir(f)) {
    if (/from\s+['"]@\/lib\/server\//.test(s) || /from\s+['"](\.\.?\/)+server\//.test(s)) bad(`${rel(f)} (klien) mengimpor lib/server`);
    if (/firebase-admin/.test(s)) bad(`${rel(f)} (klien) menyebut firebase-admin`);
    if (SECRET_NAMES.test(s)) bad(`${rel(f)} (klien) menyebut nama variabel rahasia`);
    if (/process\.env\.(?!NEXT_PUBLIC_|NODE_ENV)/.test(s)) bad(`${rel(f)} (klien) membaca process.env non-publik`);
  } else if (rel(f).startsWith('lib/server/') && !/^import 'server-only';/m.test(s)) bad(`${rel(f)} tidak memakai import 'server-only'`);
  if (/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PRIVATE|SERVICE|ADMIN)/.test(s)) bad(`${rel(f)} memakai NEXT_PUBLIC_* bernama rahasia`);
}
// pola kunci ter-hardcode
for (const f of files) {
  if (rel(f) === 'scripts/check-secrets.js' || rel(f).endsWith('.sql')) continue;
  const s = fs.readFileSync(f, 'utf8');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s)) bad(`${rel(f)} berisi private key`);
  if (/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/.test(s)) bad(`${rel(f)} berisi string mirip JWT`);
  if (/AIza[0-9A-Za-z_-]{35}/.test(s)) bad(`${rel(f)} berisi string mirip API key Google`);
  if (/sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/.test(s)) bad(`${rel(f)} berisi string mirip kunci Supabase`);
}
// .env.example
const ex = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const vars = {};
for (const l of ex.split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) { vars[m[1]] = m[2]; if (m[2] !== '') bad(`.env.example: ${m[1]} berisi nilai (harus kosong)`); } }
for (const k of Object.keys(vars)) if (/^NEXT_PUBLIC_.*(SECRET|PRIVATE|SERVICE|ADMIN)/.test(k)) bad(`.env.example: ${k} rahasia memakai NEXT_PUBLIC_`);
const used = new Set();
for (const f of code) for (const m of fs.readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(m[1]);
for (const u of used) if (!['NODE_ENV', 'PORT', 'VERCEL_GIT_COMMIT_SHA', 'NEXT_PUBLIC_BUILD_ID'].includes(u) && !(u in vars)) bad(`variabel ${u} dipakai kode tetapi tidak ada di .env.example`);
for (const must of ['FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL', 'SUPABASE_SERVICE_ROLE_KEY']) if (!(must in vars)) bad(`.env.example kehilangan ${must}`);
// .gitignore melindungi file env
const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
if (!/^\.env$/m.test(gi) || !/^\.env\.\*$/m.test(gi) || !/^!\.env\.example$/m.test(gi)) bad('.gitignore belum melindungi .env* (kecuali .env.example)');
console.log(`check-secrets: ${n} file kode diperiksa, ${Object.keys(vars).length} variabel di .env.example, ${used.size} variabel dipakai kode. ${fails ? fails + ' MASALAH' : 'OK'}`);
process.exit(fails ? 1 : 0);
