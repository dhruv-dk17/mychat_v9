// crypto.js — Mychat v9
// All cryptographic operations happen here, locally in the browser.
// Private keys NEVER leave this device.
'use strict';

const Crypto = (() => {
  // ── Key Storage ────────────────────────────────────────────────────────────
  const PRIVATE_KEY_STORE = 'v9_privateKey';
  const PUBLIC_KEY_STORE  = 'v9_publicKey';

  // ── Generate ECDH P-256 Keypair ───────────────────────────────────────────
  async function generateIdentityKeypair() {
    const keypair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,  // extractable so we can export and store
      ['deriveKey', 'deriveBits']
    );
    const publicRaw  = await crypto.subtle.exportKey('spki', keypair.publicKey);
    const privateRaw = await crypto.subtle.exportKey('pkcs8', keypair.privateKey);

    const publicB64  = btoa(String.fromCharCode(...new Uint8Array(publicRaw)));
    const privateB64 = btoa(String.fromCharCode(...new Uint8Array(privateRaw)));

    localStorage.setItem(PUBLIC_KEY_STORE, publicB64);
    localStorage.setItem(PRIVATE_KEY_STORE, privateB64);

    return { publicKey: publicB64 };
  }

  async function loadPrivateKey() {
    const b64 = localStorage.getItem(PRIVATE_KEY_STORE);
    if (!b64) throw new Error('No local private key found');
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return crypto.subtle.importKey('pkcs8', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits']);
  }

  function getPublicKeyB64() {
    return localStorage.getItem(PUBLIC_KEY_STORE);
  }

  // ── Derive Shared Secret via ECDH ─────────────────────────────────────────
  async function deriveSharedKey(theirPublicKeyB64) {
    const raw = Uint8Array.from(atob(theirPublicKeyB64), c => c.charCodeAt(0));
    const theirKey = await crypto.subtle.importKey('spki', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const myPrivate = await loadPrivateKey();

    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: theirKey },
      myPrivate,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ── AES-GCM Encrypt ───────────────────────────────────────────────────────
  async function encrypt(sharedKey, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, encoded);
    // Pack: iv (12 bytes) + ciphertext → base64
    const packed = new Uint8Array(iv.byteLength + cipher.byteLength);
    packed.set(iv, 0);
    packed.set(new Uint8Array(cipher), iv.byteLength);
    return btoa(String.fromCharCode(...packed));
  }

  // ── AES-GCM Decrypt ───────────────────────────────────────────────────────
  async function decrypt(sharedKey, b64Payload) {
    try {
      const packed = Uint8Array.from(atob(b64Payload), c => c.charCodeAt(0));
      const iv = packed.slice(0, 12);
      const cipher = packed.slice(12);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, cipher);
      return new TextDecoder().decode(plain);
    } catch {
      return '⚠️ Decryption Error';
    }
  }

  // ── Hash Recovery Phrase (for server storage) ────────────────────────────
  // Uses PBKDF2 → consistent hash. server stores this, not the raw phrase.
  async function hashRecoveryPhrase(phrase) {
    const enc = new TextEncoder().encode(phrase.trim().toLowerCase());
    const keyMaterial = await crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveBits']);
    const salt = new TextEncoder().encode('mychat-v9-static-salt');
    const bits  = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
      keyMaterial, 256
    );
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  }

  // ── Generate 3-word recovery phrase ──────────────────────────────────────
  function generateRecoveryPhrase() {
    const WORDS = [
      'alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel',
      'india','juliet','kilo','lima','mike','november','oscar','papa',
      'quebec','romeo','sierra','tango','uniform','victor','whiskey',
      'xray','yankee','zulu','apple','brick','cloud','drift','ember',
      'flame','grove','haven','inlet','jade','knoll','lunar','marsh',
      'nexus','orbit','prism','quest','ridge','shore','titan','umbra',
      'vault','wave','xenon','yield','zenith','arc','bay','cave','dune',
      'edge','ford','gale','hill','isle','jade','keep','loch','mist',
    ];
    const pick = () => WORDS[crypto.getRandomValues(new Uint32Array(1))[0] % WORDS.length];
    return `${pick()}-${pick()}-${pick()}`;
  }

  return {
    generateIdentityKeypair,
    loadPrivateKey,
    getPublicKeyB64,
    deriveSharedKey,
    encrypt,
    decrypt,
    hashRecoveryPhrase,
    generateRecoveryPhrase,
    hasLocalKeys: () => Boolean(localStorage.getItem(PRIVATE_KEY_STORE)),
  };
})();

window.Crypto = Crypto;
