// Web Push tanpa pustaka luar: tanda tangan VAPID (RFC 8292) dan enkripsi
// payload aes128gcm (RFC 8291) memakai modul crypto bawaan Node.
import crypto from 'node:crypto';

const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(String(s || '').trim(), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Kunci VAPID dari secret VAPID_PRIVATE_KEY (32 byte, base64url).
export function kunciVapid(rahasia) {
  const d = fromB64u(rahasia);
  if (d.length !== 32) throw new Error('VAPID_PRIVATE_KEY tidak valid (harus 32 byte base64url dari panel admin).');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey();
  const jwk = { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) };
  return { d, publik: b64u(pub), privateKey: crypto.createPrivateKey({ key: jwk, format: 'jwk' }) };
}

// Header Authorization VAPID untuk satu endpoint (berlaku 12 jam).
export function headerVapid(endpoint, kunci, subjek) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subjek }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key: kunci.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${kunci.publik}`;
}

// Enkripsi payload untuk satu langganan (satu record, RFC 8188).
export function enkripsiPayload(payload, p256dh, auth, { salt = crypto.randomBytes(16), server } = {}) {
  const uaPub = fromB64u(p256dh);
  const secret = fromB64u(auth);
  if (uaPub.length !== 65 || secret.length !== 16) throw new Error('Kunci langganan tidak valid.');
  const as = server || crypto.createECDH('prime256v1');
  if (!server) as.generateKeys();
  const asPub = as.getPublicKey();
  const prkKey = hmac(secret, as.computeSecret(uaPub));
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  if (plain.length > 4096 - 17) throw new Error('Payload notifikasi terlalu besar.');
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head[20] = asPub.length;
  return Buffer.concat([head, asPub, body]);
}

// Langganan disimpan di repo terenkripsi ke kunci publik VAPID (ECDH P-256 +
// HKDF + AES-256-GCM, lihat assets/notifikasi.js); hanya pemegang secret yang bisa membukanya.
export function bukaLangganan(enc, kunci) {
  const epk = fromB64u(enc.epk);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(kunci.d);
  const key = Buffer.from(crypto.hkdfSync('sha256', ecdh.computeSecret(epk), epk, Buffer.from('laporanmagang-langganan'), 32));
  const data = fromB64u(enc.data);
  const d = crypto.createDecipheriv('aes-256-gcm', key, fromB64u(enc.iv));
  d.setAuthTag(data.subarray(-16));
  const sub = JSON.parse(Buffer.concat([d.update(data.subarray(0, -16)), d.final()]).toString('utf8'));
  if (!/^https:\/\//.test(sub.endpoint || '') || !sub.keys) throw new Error('Isi langganan tidak valid.');
  return sub;
}

// Kirim satu notifikasi. Mengembalikan status HTTP layanan push.
export async function kirimPush(sub, payload, kunci, subjek, { ttl = 86400, urgensi = 'normal' } = {}) {
  const body = enkripsiPayload(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(ttl),
      Urgency: urgensi,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: headerVapid(sub.endpoint, kunci, subjek)
    },
    body
  });
  return res.status;
}
