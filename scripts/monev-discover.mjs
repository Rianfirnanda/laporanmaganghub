// Robot pengintai monev MagangHub (tahap 1).
//
// Login ke monev.maganghub.kemnaker.go.id memakai akun dari GitHub Secrets,
// lalu menulis laporan STRUKTUR halaman ke ringkasan job GitHub Actions:
// kolom formulir login, judul/kolom tabel, alamat API (tanpa angka/ID) dan
// nama field JSON-nya. Nilai data (nama, tanggal, NIK, token, dll.) TIDAK
// ditulis karena log Actions pada repository public bisa dibaca siapa saja.
//
// Laporan ini dipakai untuk membuat skrip sinkronisasi daftar hadir.

import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.MONEV_BASE || 'https://monev.maganghub.kemnaker.go.id';
const USER = process.env.MONEV_USERNAME || '';
const PASS = process.env.MONEV_PASSWORD || '';
const SUMMARY = process.env.GITHUB_STEP_SUMMARY || '/dev/stdout';
const KEYWORDS = /hadir|absen|presensi|kehadiran|attendance|logbook|laporan|kegiatan/i;

const out = [];
const log = line => { out.push(line); console.log(line.replace(/[`*]/g, '')); };

// Hilangkan bagian URL yang bisa berisi data pribadi (angka, UUID, query).
function cleanUrl(u) {
  try {
    const url = new URL(u);
    const path = url.pathname
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
      .replace(/\/\d+(?=\/|$)/g, '/:id')
      .replace(/[A-Za-z0-9_-]{24,}/g, ':token');
    const params = [...url.searchParams.keys()].join(',');
    return `${url.origin}${path}${params ? ` ?${params}` : ''}`;
  } catch { return '(url tidak valid)'; }
}

// Bentuk data JSON: hanya nama field dan tipe, tanpa nilai.
function shape(v, depth = 0) {
  if (depth > 4) return '…';
  if (Array.isArray(v)) return v.length ? [`${v.length} item`, shape(v[0], depth + 1)] : ['kosong'];
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).slice(0, 40)) o[k] = shape(v[k], depth + 1);
    return o;
  }
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return 'tanggal';
    if (/^\d{1,2}:\d{2}/.test(v)) return 'jam';
    return 'teks';
  }
  return typeof v;
}

async function describeForm(page) {
  return page.$$eval('input, select, textarea, button', els => els.slice(0, 30).map(e => ({
    tag: e.tagName.toLowerCase(),
    type: e.getAttribute('type') || '',
    name: e.getAttribute('name') || '',
    id: e.id || '',
    placeholder: e.getAttribute('placeholder') || '',
    text: e.tagName === 'BUTTON' ? (e.innerText || '').trim().slice(0, 40) : ''
  })));
}

async function describePage(page, title) {
  log(`\n### ${title}`);
  log(`- URL: \`${cleanUrl(page.url())}\``);
  log(`- Judul tab: ${await page.title()}`);
  const info = await page.evaluate(kw => {
    const re = new RegExp(kw, 'i');
    const txt = el => (el.innerText || '').replace(/\s+/g, ' ').trim();
    return {
      headings: [...document.querySelectorAll('h1,h2,h3,h4')].map(txt).filter(Boolean).slice(0, 20),
      tables: [...document.querySelectorAll('table')].slice(0, 5).map(t => [...t.querySelectorAll('thead th, tr:first-child th')].map(txt)),
      rows: [...document.querySelectorAll('table')].slice(0, 5).map(t => t.querySelectorAll('tbody tr').length),
      links: [...document.querySelectorAll('a[href], button, [role="tab"], [role="menuitem"]')]
        .map(e => ({ t: txt(e).slice(0, 50), h: e.getAttribute('href') || '' }))
        .filter(l => re.test(l.t) || re.test(l.h)).slice(0, 25),
      captcha: Boolean(document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, [class*="captcha" i], img[src*="captcha" i]'))
    };
  }, KEYWORDS.source);
  if (info.captcha) log('- ⚠️ **Terdeteksi CAPTCHA** di halaman ini.');
  if (info.headings.length) log(`- Judul bagian: ${info.headings.map(h => `"${h}"`).join(', ')}`);
  info.tables.forEach((cols, i) => log(`- Tabel ${i + 1}: ${info.rows[i]} baris, kolom: ${cols.map(c => `"${c}"`).join(', ') || '(tanpa header)'}`));
  if (info.links.length) log(`- Menu terkait: ${info.links.map(l => `"${l.t}"${l.h ? ` → \`${cleanUrl(new URL(l.h, page.url()).href)}\`` : ''}`).join('; ')}`);
  return info;
}

async function main() {
  log('## Laporan struktur monev MagangHub');
  log('_Hanya struktur halaman. Nilai data pribadi tidak ditampilkan._');
  if (!USER || !PASS) {
    log('\n❌ Secret `MONEV_USERNAME` / `MONEV_PASSWORD` belum diisi di Settings → Secrets and variables → Actions.');
    return 1;
  }

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await browser.newContext({ locale: 'id-ID', timezoneId: 'Asia/Jakarta', viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const apis = new Map();
  page.on('response', async res => {
    const ct = res.headers()['content-type'] || '';
    const req = res.request();
    if (!['xhr', 'fetch'].includes(req.resourceType())) return;
    const key = `${req.method()} ${cleanUrl(res.url())}`;
    const entry = { status: res.status(), type: ct.split(';')[0] };
    if (ct.includes('json')) {
      try { entry.shape = shape(await res.json()); } catch { /* bukan JSON */ }
    }
    apis.set(key, entry);
  });

  try {
    // Jangan menunggu "networkidle": situs SPA bisa terus memuat di latar.
    const resp = await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    log(`\n- Status awal: HTTP ${resp ? resp.status() : '?'}`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
  } catch (e) {
    log(`\n❌ Tidak bisa membuka monev dari server GitHub: ${e.message.split('\n')[0]}`);
    log('Kemungkinan situs memblokir akses dari luar Indonesia.');
    await browser.close();
    return 1;
  }

  await describePage(page, 'Halaman sebelum login');
  log('\n**Kolom formulir:**');
  for (const f of await describeForm(page)) log(`- \`${JSON.stringify(f)}\``);

  let loginFailed = false;

  // Login tunggal (SSO): monev bisa mengalihkan ke SIAPkerja/MagangHub, atau
  // menampilkan tombol "Masuk dengan SIAPkerja" dulu. Ikuti sampai 3 langkah
  // hingga kolom kata sandi muncul.
  for (let hop = 0; hop < 3 && !(await page.$('input[type="password"]')); hop++) {
    // Formulir dua langkah: email/NIK dulu, kata sandi di layar berikutnya.
    const idField = await page.$('input[type="email"], input[name*="email" i], input[name*="user" i], input[name*="nik" i], input[name*="login" i]');
    if (idField) {
      log('\n- Mengisi email/username (formulir dua langkah)');
      await idField.fill(USER);
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}),
        idField.press('Enter')
      ]);
      await page.waitForTimeout(3000);
      if (await page.$('input[type="password"]')) break;
    }
    const btn = page.locator('a, button, [role="button"]').filter({ hasText: /siap\s*kerja|masuk|login|log in|sign in|lanjut|next/i }).first();
    if (!(await btn.count())) break;
    const label = ((await btn.innerText().catch(() => '')) || '').trim().slice(0, 40);
    log(`\n- Mengklik tombol login "${label}"`);
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}),
      btn.click({ timeout: 10000 }).catch(() => {})
    ]);
    await page.waitForTimeout(3000);
    await describePage(page, `Halaman login (langkah ${hop + 1})`);
    log('\n**Kolom formulir:**');
    for (const f of await describeForm(page)) log(`- \`${JSON.stringify(f)}\``);
  }

  const pass = await page.$('input[type="password"]');
  if (!pass) {
    log('\n⚠️ Kolom kata sandi tidak ditemukan. Login mungkin lewat tombol/halaman lain (lihat daftar tombol di atas).');
  } else {
    const user = await page.$('input[type="email"], input[name*="email" i], input[name*="user" i], input[name*="nik" i], input[id*="email" i], input[id*="user" i], input[type="text"]');
    if (user) await user.fill(USER);
    await pass.fill(PASS);
    const submit = await page.$('button[type="submit"], input[type="submit"]') ||
      await page.$('button:has-text("Masuk"), button:has-text("Login"), button:has-text("Log in")');
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}),
      submit ? submit.click() : pass.press('Enter')
    ]);
    await page.waitForTimeout(4000);
    const stillLogin = await page.$('input[type="password"]');
    loginFailed = Boolean(stillLogin);
    log(stillLogin ? '\n❌ **Login tampaknya gagal** (formulir login masih tampil). Cek username/kata sandi atau CAPTCHA/OTP.'
      : '\n✅ **Login berhasil** (formulir login sudah hilang).');
    if (stillLogin) {
      const err = await page.evaluate(() => [...document.querySelectorAll('[role="alert"], .error, .alert, .invalid-feedback, [class*="error" i]')]
        .map(e => (e.innerText || '').trim()).filter(Boolean).slice(0, 5));
      if (err.length) log(`- Pesan di halaman: ${err.map(x => `"${x.slice(0, 120)}"`).join('; ')}`);
    }
  }

  const home = await describePage(page, 'Halaman setelah login');

  // Kunjungi menu yang tampak berhubungan dengan daftar hadir.
  const visited = new Set([cleanUrl(page.url())]);
  for (const l of home.links.filter(l => /hadir|absen|presensi|kehadiran|attendance/i.test(`${l.t} ${l.h}`)).slice(0, 4)) {
    try {
      if (l.h && !l.h.startsWith('#') && !l.h.startsWith('javascript')) {
        const target = new URL(l.h, page.url()).href;
        if (visited.has(cleanUrl(target))) continue;
        visited.add(cleanUrl(target));
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      } else {
        await page.getByText(l.t, { exact: true }).first().click({ timeout: 8000 });
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      }
      await page.waitForTimeout(2500);
      await describePage(page, `Menu "${l.t}"`);
    } catch (e) {
      log(`\n- Gagal membuka menu "${l.t}": ${e.message.split('\n')[0]}`);
    }
  }

  log('\n### Permintaan data (API) yang terlihat');
  if (!apis.size) log('- (tidak ada permintaan XHR/fetch)');
  for (const [k, v] of apis) {
    log(`- \`${k}\` → ${v.status} ${v.type}`);
    if (v.shape) log(`  <details><summary>struktur JSON</summary>\n\n  \`\`\`json\n  ${JSON.stringify(v.shape).slice(0, 1500)}\n  \`\`\`\n  </details>`);
  }

  await browser.close();
  return loginFailed ? 1 : 0;
}

const code = await main().catch(e => { log(`\n❌ Error: ${String(e.message || e).split('\n')[0]}`); return 1; });
fs.appendFileSync(SUMMARY, out.join('\n') + '\n');
process.exit(code);
