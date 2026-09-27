// Penulis laporan AI bersama: dipakai panel admin (browser) dan robot
// GitHub Actions (scripts/laporan-harian.mjs). Tanpa DOM, hanya fetch.
//
// Agar jarang gagal, permintaan dicoba berlapis:
//   1. Gemini (Google AI Studio, gratis) – model pilihan, lalu model Flash
//      lain yang kuotanya terpisah (mis. Flash-Lite, 1.000 permintaan/hari).
//   2. Groq (gratis, sangat cepat) – GPT-OSS 120B, Llama 3.3 70B, Llama 3.1 8B.
// Galat sementara (503 "high demand", 500, 504, jaringan) diulang dengan jeda.

/* eslint-disable no-unused-vars */
const AI_GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const AI_GROQ_API = 'https://api.groq.com/openai/v1';
const AI_GEMINI_DEFAULT = 'gemini-2.5-flash';
const AI_GEMINI_FALLBACKS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
const AI_GROQ_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

const AI_SYSTEM = `Kamu membantu seorang peserta magang menulis laporan harian untuk daftar hadir di monev MagangHub Kemnaker. Laporan diisi setiap sore dan terdiri dari tiga bagian: ringkasan kegiatan, pembelajaran yang didapat, dan kendala yang dihadapi.

Tulis seolah-olah peserta sendiri yang menulis: bahasa Indonesia sehari-hari yang sopan, sudut pandang orang pertama ("saya"), kalimat yang mengalir, tanpa poin-poin, tanpa judul, tanpa emoji, dan tanpa kalimat pembuka seperti "Berikut" atau "Pada hari ini saya telah melaksanakan". Variasikan susunan kalimat dan hindari frasa klise seperti "sangat bermanfaat", "menambah wawasan", atau "secara keseluruhan".

- ringkasan: 2-4 kalimat tentang apa saja yang dikerjakan dari pagi sampai sore, mengikuti urutan catatan. Sebut hal konkret (nama pekerjaan, jumlah, aplikasi, tempat) bila ada di catatan.
- pembelajaran: 1-3 kalimat tentang hal yang dipelajari atau keterampilan yang terasah dari kegiatan itu, masuk akal berdasarkan catatan, bukan pujian umum.
- kendala: 1-2 kalimat tentang kendala yang tersirat di catatan beserta cara mengatasinya bila disebut. Jika catatan tidak menyebut kendala, tulis singkat dan jujur bahwa tidak ada kendala berarti; jangan mengarang masalah.

Jangan menambahkan kegiatan, angka, nama orang, atau detail yang tidak ada di catatan. Jika status kehadiran Sakit atau Izin, ringkasan cukup menjelaskan ketidakhadiran itu secara singkat dan sopan, lalu isi pembelajaran dan kendala dengan "-" bila tidak relevan.`;

const HARIAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ringkasan: { type: 'STRING' },
    pembelajaran: { type: 'STRING' },
    kendala: { type: 'STRING' }
  },
  required: ['ringkasan', 'pembelajaran', 'kendala'],
  propertyOrdering: ['ringkasan', 'pembelajaran', 'kendala']
};

const SUMMARY_SYSTEM = `Kamu menulis ringkasan singkat untuk halaman publik dokumentasi magang seorang peserta. Pembacanya atasan dan pengunjung, jadi tulis dalam bahasa Indonesia yang natural, hangat, dan ringkas, dengan sudut pandang orang ketiga (sebut "peserta" atau nama depannya). Tanpa poin-poin, tanpa emoji, tanpa frasa klise.

- mingguIni: 2-3 kalimat tentang apa saja yang dikerjakan pada minggu terbaru.
- sorotan: 3 frasa pendek (masing-masing maksimal 6 kata) berisi hal paling menonjol minggu terbaru.
- keseluruhan: 2-3 kalimat tentang perjalanan magang sejauh ini.

Hanya gunakan fakta dari data. Jangan mengarang kegiatan, angka, atau nama.`;

const SUMMARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mingguIni: { type: 'STRING' },
    sorotan: { type: 'ARRAY', items: { type: 'STRING' } },
    keseluruhan: { type: 'STRING' }
  },
  required: ['mingguIni', 'sorotan', 'keseluruhan'],
  propertyOrdering: ['mingguIni', 'sorotan', 'keseluruhan']
};

// ---------- Prompt ----------
function aiDayEntries(entries, date) {
  return entries.filter(e => e && e.tanggal === date).sort((a, b) => (a.jam || '').localeCompare(b.jam || ''));
}

function aiSesi(jam) {
  const h = Number(String(jam || '').split(':')[0]);
  return h < 11 ? 'Pagi' : h < 15 ? 'Siang' : 'Sore';
}

function buildHarianPrompt({ config = {}, entries = [], harian = {}, date, status = 'Hadir', ket = '', tanggalLabel }) {
  const lines = aiDayEntries(entries, date).map(e => {
    const parts = [`- ${e.jam || '??:??'} (${e.sesi || aiSesi(e.jam)}): ${e.judul}`];
    if (e.lokasi) parts.push(`Lokasi: ${e.lokasi}.`);
    if (e.keterangan) parts.push(`Catatan: ${String(e.keterangan).replace(/\s+/g, ' ')}`);
    return parts.join(' ');
  });
  const prev = Object.keys(harian).filter(d => d < date && harian[d] && harian[d].ringkasan).sort().pop();
  return [
    `Peserta: ${config.posisi || 'peserta magang'} di ${config.instansi || 'instansi'}.`,
    `Tanggal: ${tanggalLabel || date}. Status kehadiran: ${status}${ket ? ` (${ket})` : ''}.`,
    '',
    lines.length ? `Catatan kegiatan hari ini, urut jam:\n${lines.join('\n')}` : 'Tidak ada catatan kegiatan pada hari ini.',
    prev ? `\nRingkasan laporan hari sebelumnya, untuk dihindari susunan kalimatnya agar tidak berulang:\n${harian[prev].ringkasan}` : '',
    '',
    'Tulis ketiga isian laporan daftar hadir untuk hari ini.'
  ].join('\n');
}

function aiMingguKe(mulai, date) {
  const [y1, m1, d1] = mulai.split('-').map(Number);
  const [y2, m2, d2] = date.split('-').map(Number);
  return Math.floor((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000 / 7) + 1;
}

function buildSummaryPrompt({ config = {}, entries = [], harian = {} }) {
  const dates = [...new Set([...entries.map(e => e.tanggal), ...Object.keys(harian)])].filter(Boolean).sort();
  if (!dates.length) return null;
  const mulai = config.tanggalMulai || dates[0];
  const lastWeek = aiMingguKe(mulai, dates[dates.length - 1]);
  const lines = dates.map(d => {
    const w = aiMingguKe(mulai, d);
    const r = harian[d] || {};
    const titles = aiDayEntries(entries, d).map(e => e.judul).join('; ');
    const st = ['Sakit', 'Izin'].includes(r.status) ? ` [${r.status}]` : '';
    const detail = w === lastWeek && r.ringkasan ? ` Ringkasan: ${r.ringkasan}` : '';
    return `- Minggu ${w}, ${d}${st}: ${titles || '(tidak ada kegiatan)'}${detail}`;
  });
  return {
    minggu: lastWeek,
    prompt: [
      `Peserta: ${config.nama || 'peserta'} (${config.posisi || 'peserta magang'}) di ${config.instansi || 'instansi'}. Minggu terbaru: ${lastWeek}.`,
      'Data kegiatan per hari:',
      ...lines.slice(-60)
    ].join('\n')
  };
}

// Sidik jari isi kegiatan satu hari. Laporan otomatis ditulis ulang hanya bila
// sidik jari berubah (kegiatan ditambah/diubah), sama di browser dan robot.
function sumberHarian(entries, date) {
  const s = JSON.stringify(aiDayEntries(entries, date).map(e => [e.id, e.jam, e.judul, e.keterangan || '', e.lokasi || '']));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// Laporan perlu (ditulis ulang) oleh AI? Tidak pernah menimpa hasil edit manual.
function perluLaporanAi(entries, harian, date) {
  const rec = harian[date];
  if (!aiDayEntries(entries, date).length) return false;
  if (!rec || !(rec.ringkasan || rec.pembelajaran || rec.kendala)) return true;
  if (rec.auto === false || ['Sakit', 'Izin'].includes(rec.status)) return false;
  // Laporan lama tanpa sidik jari dibiarkan apa adanya (bisa jadi sudah diperiksa).
  return Boolean(rec.sumber) && rec.sumber !== sumberHarian(entries, date);
}

// ---------- Pemanggil model ----------
class AiError extends Error {
  constructor(message, { status = 0, retry = false, nextModel = false, fatal = false } = {}) {
    super(message);
    Object.assign(this, { status, retry, nextModel, fatal });
  }
}

const aiSleep = ms => new Promise(r => setTimeout(r, ms));

async function aiReadError(res) {
  let m = res.statusText || `HTTP ${res.status}`;
  let detail = '';
  try {
    const body = await res.json();
    const err = body.error || {};
    m = err.message || body.message || m;
    detail = JSON.stringify(err.details || err.code || '');
  } catch { /* abaikan */ }
  return { m, detail };
}

async function geminiRequest(key, path, body) {
  let res;
  try {
    res = await fetch(`${AI_GEMINI_API}/${path}`, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'x-goog-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new AiError('Gemini tidak terjangkau (jaringan).', { retry: true });
  }
  if (res.ok) return res.json();
  const { m, detail } = await aiReadError(res);
  const s = res.status;
  if (/API_KEY_INVALID|API key not valid|API_KEY_/i.test(`${m} ${detail}`)) throw new AiError('Kunci API Gemini tidak valid.', { status: s, fatal: true });
  if (s === 403) throw new AiError('Kunci API tidak diizinkan memakai Gemini API. Pastikan kunci dibuat di Google AI Studio.', { status: s, fatal: true });
  if (s === 429) throw new AiError('Kuota gratis model ini sedang habis.', { status: s, nextModel: true });
  if (s === 404 || s === 400) throw new AiError(`Model tidak tersedia (${m}).`, { status: s, nextModel: true });
  if (s >= 500) throw new AiError('Server Gemini sedang sibuk.', { status: s, retry: true });
  throw new AiError(m, { status: s, nextModel: true });
}

function geminiText(data) {
  if (data.promptFeedback && data.promptFeedback.blockReason) throw new AiError('Gemini menolak memproses catatan ini.', { nextModel: true });
  const cand = (data.candidates || [])[0];
  if (!cand) throw new AiError('Gemini tidak memberi jawaban.', { retry: true });
  if (cand.finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(cand.finishReason)) {
    throw new AiError(`Gemini berhenti (${cand.finishReason}).`, { retry: cand.finishReason === 'MAX_TOKENS', nextModel: true });
  }
  return ((cand.content || {}).parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
}

async function groqRequest(key, path, body) {
  let res;
  try {
    res = await fetch(`${AI_GROQ_API}/${path}`, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new AiError('Groq tidak terjangkau (jaringan).', { retry: true });
  }
  if (res.ok) return res.json();
  const { m } = await aiReadError(res);
  const s = res.status;
  if (s === 401) throw new AiError('Kunci API Groq tidak valid.', { status: s, fatal: true });
  if (s === 429) throw new AiError('Batas gratis Groq untuk model ini tercapai.', { status: s, nextModel: true });
  if (s === 404 || s === 400) throw new AiError(`Model Groq tidak tersedia (${m}).`, { status: s, nextModel: true });
  if (s >= 500) throw new AiError('Server Groq sedang sibuk.', { status: s, retry: true });
  throw new AiError(m, { status: s, nextModel: true });
}

function schemaHint(schema) {
  const keys = Object.entries(schema.properties).map(([k, v]) => `"${k}": ${v.type === 'ARRAY' ? '["..."]' : '"..."'}`);
  return `\n\nJawab HANYA dengan satu objek JSON valid berbentuk {${keys.join(', ')}}.`;
}

function parseJson(text, schema) {
  const clean = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let out;
  try { out = JSON.parse(clean); } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    try { out = m && JSON.parse(m[0]); } catch { out = null; }
  }
  if (!out || typeof out !== 'object') throw new AiError('Jawaban AI tidak terbaca.', { retry: true, nextModel: true });
  for (const k of schema.required) if (out[k] === undefined) throw new AiError('Jawaban AI tidak lengkap.', { retry: true, nextModel: true });
  return out;
}

// Coba satu model dengan pengulangan untuk galat sementara.
async function aiAttempt(fn, onStatus, label, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!(e instanceof AiError) || !e.retry || i === tries - 1) throw e;
      if (onStatus) onStatus(`${label}: ${e.message} Mencoba lagi…`);
      await aiSleep(1500 * 2 ** i + Math.random() * 500);
    }
  }
  throw last;
}

// Menghasilkan objek JSON sesuai skema dari penyedia yang tersedia.
// keys = { gemini, groq }; hasil = { data, provider, model }.
async function aiGenerate({ keys = {}, geminiModel, geminiModels = [], system, prompt, schema, temperature = 0.9, onStatus }) {
  const errors = [];
  if (keys.gemini) {
    const models = [...new Set([geminiModel, ...AI_GEMINI_FALLBACKS.filter(m => !geminiModels.length || geminiModels.includes(m))].filter(Boolean))];
    for (const model of models) {
      try {
        const data = await aiAttempt(async () => parseJson(geminiText(await geminiRequest(keys.gemini, `models/${encodeURIComponent(model)}:generateContent`, {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: 8192, responseMimeType: 'application/json', responseSchema: schema }
        })), schema), onStatus, model);
        return { data, provider: 'Gemini', model };
      } catch (e) {
        errors.push(`${model}: ${e.message}`);
        if (e.fatal) break;
        if (onStatus) onStatus(`${model} gagal (${e.message}) Beralih ke model lain…`);
      }
    }
  }
  if (keys.groq) {
    for (const model of AI_GROQ_MODELS) {
      try {
        const data = await aiAttempt(async () => {
          const res = await groqRequest(keys.groq, 'chat/completions', {
            model,
            messages: [{ role: 'system', content: system + schemaHint(schema) }, { role: 'user', content: prompt }],
            temperature: Math.min(temperature, 1),
            max_tokens: 4096,
            response_format: { type: 'json_object' },
            ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {})
          });
          const choice = (res.choices || [])[0];
          if (!choice) throw new AiError('Groq tidak memberi jawaban.', { retry: true });
          return parseJson(choice.message && choice.message.content, schema);
        }, onStatus, model, 2);
        return { data, provider: 'Groq', model };
      } catch (e) {
        errors.push(`${model}: ${e.message}`);
        if (e.fatal) break;
        if (onStatus) onStatus(`${model} gagal (${e.message}) Beralih ke model lain…`);
      }
    }
  }
  if (!keys.gemini && !keys.groq) throw new Error('Kunci API AI belum diatur. Isi di kartu "Asisten AI".');
  const busy = errors.some(e => /sibuk|jaringan/.test(e));
  throw new Error(`${busy ? 'Semua layanan AI sedang sibuk' : 'AI gagal menulis laporan'}. ${errors.slice(-3).join(' · ')}${keys.groq ? '' : ' Tambahkan kunci Groq (gratis) sebagai cadangan agar lebih jarang gagal.'}`);
}

function cleanHarian(out) {
  return {
    ringkasan: String(out.ringkasan || '').trim(),
    pembelajaran: String(out.pembelajaran || '').trim(),
    kendala: String(out.kendala || '').trim()
  };
}

function cleanSummary(out) {
  return {
    mingguIni: String(out.mingguIni || '').trim(),
    sorotan: (Array.isArray(out.sorotan) ? out.sorotan : []).map(x => String(x).trim()).filter(Boolean).slice(0, 4),
    keseluruhan: String(out.keseluruhan || '').trim()
  };
}

// Validasi kunci: daftar model Gemini (yang mendukung generateContent) / Groq.
async function listGeminiModels(key) {
  const data = await geminiRequest(key, 'models?pageSize=200');
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(m => /^gemini-/.test(m));
}

async function listGroqModels(key) {
  const data = await groqRequest(key, 'models');
  return (data.data || []).map(m => m.id);
}

if (typeof module !== 'undefined') {
  module.exports = {
    AI_SYSTEM, HARIAN_SCHEMA, SUMMARY_SYSTEM, SUMMARY_SCHEMA, AI_GEMINI_DEFAULT,
    buildHarianPrompt, buildSummaryPrompt, sumberHarian, perluLaporanAi, aiDayEntries,
    aiGenerate, cleanHarian, cleanSummary, listGeminiModels, listGroqModels
  };
}
