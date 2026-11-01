'use strict';
// Stessa cifratura dell'app (domain/alexa/Alexa.kt): AES-256-GCM, "v1." + base64url(iv | testo cifrato | tag),
// con il topic come dato associato (AAD). Il codice di collegamento è "TF1.<topic>.<chiave base64url>".
const crypto = require('crypto');

const PREFIX = 'TF1.';
const TOPIC = /^[A-Za-z0-9_-]{16,64}$/;

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  let b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64');
}

/** null se il codice manca o è sbagliato (per esempio incollato a metà). */
function parsePairing(code) {
  const c = String(code || '').trim();
  if (!c.startsWith(PREFIX)) return null;
  const parts = c.slice(PREFIX.length).split('.');
  if (parts.length !== 2 || !TOPIC.test(parts[0])) return null;
  const key = fromB64url(parts[1]);
  if (key.length !== 32) return null;
  return { topic: parts[0], key, tag: crypto.createHash('sha256').update(c).digest('hex').slice(0, 16) };
}

function seal(plain, pairing, iv = crypto.randomBytes(12)) {
  const cipher = crypto.createCipheriv('aes-256-gcm', pairing.key, iv);
  cipher.setAAD(Buffer.from(pairing.topic, 'utf8'));
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return 'v1.' + b64url(Buffer.concat([iv, ct, cipher.getAuthTag()]));
}

function open(sealed, pairing) {
  try {
    if (!String(sealed).startsWith('v1.')) return null;
    const bytes = fromB64url(String(sealed).slice(3));
    if (bytes.length <= 28) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', pairing.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(pairing.topic, 'utf8'));
    decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    return Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

module.exports = { parsePairing, seal, open, b64url, fromB64url };
