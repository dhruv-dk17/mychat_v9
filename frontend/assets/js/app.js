// app.js — Mychat v9 
// Auth logic: register, login, recovery
'use strict';

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username')?.value.trim().toLowerCase();
  const password = document.getElementById('reg-password')?.value;
  const setError = msg => { const el = document.getElementById('reg-error'); if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; } };
  const setLoading = on => { const btn = document.getElementById('reg-btn'); if (btn) { btn.disabled = on; btn.textContent = on ? 'Creating...' : 'Create Account'; } };

  if (!username || !password) return setError('All fields required');
  if (password.length < 8) return setError('Password must be at least 8 characters');

  try {
    setLoading(true);
    setError('');

    // 1. Generate E2EE keypair locally
    const { publicKey } = await Crypto.generateIdentityKeypair();

    // 2. Generate recovery phrase & hash it (send ONLY hash to server)
    const recoveryPhrase = Crypto.generateRecoveryPhrase();
    const recoveryPhraseHash = await Crypto.hashRecoveryPhrase(recoveryPhrase);

    // 3. Register
    const res = await fetch(`${CONFIG.API_BASE}/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, recoveryPhraseHash, identityPublicKey: publicKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');

    // 4. Show recovery phrase once — must be saved
    showRecoveryPhrase(recoveryPhrase, () => {
      saveUserSession({ username: data.username, token: data.token });
      window.location.href = 'chat.html';
    });
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username')?.value.trim().toLowerCase();
  const password = document.getElementById('login-password')?.value;
  const setError = msg => { const el = document.getElementById('login-error'); if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; } };
  const setLoading = on => { const btn = document.getElementById('login-btn'); if (btn) { btn.disabled = on; btn.textContent = on ? 'Signing in...' : 'Sign In'; } };

  if (!username || !password) return setError('Enter username and password');

  try {
    setLoading(true);
    setError('');

    // Re-upload public key on login (in case it expired or device changed)
    const publicKey = Crypto.getPublicKeyB64();

    const res = await fetch(`${CONFIG.API_BASE}/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, ...(publicKey ? { identityPublicKey: publicKey } : {}) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    saveUserSession({ username: data.username, token: data.token });
    window.location.href = 'chat.html';
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
}

async function handleRecover(e) {
  e.preventDefault();
  const username = document.getElementById('rec-username')?.value.trim().toLowerCase();
  const phrase   = document.getElementById('rec-phrase')?.value.trim();
  const newPass  = document.getElementById('rec-newpass')?.value;
  const setError = msg => { const el = document.getElementById('rec-error'); if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; } };
  const setLoading = on => { const btn = document.getElementById('rec-btn'); if (btn) { btn.disabled = on; btn.textContent = on ? 'Recovering...' : 'Recover Account'; } };

  if (!username || !phrase || !newPass) return setError('All fields required');
  if (newPass.length < 8) return setError('New password must be at least 8 characters');

  try {
    setLoading(true);
    setError('');

    const recoveryPhraseHash = await Crypto.hashRecoveryPhrase(phrase);
    const newPasswordHashRaw = await Crypto.hashRecoveryPhrase(newPass + '_pw'); // subtle differentiation
    
    const res = await fetch(`${CONFIG.API_BASE}/users/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, recoveryPhraseHash, newPasswordHash: newPasswordHashRaw }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Recovery failed');

    showToast('Password updated — please log in', 'success');
    switchAuthTab('login');
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
}

function showRecoveryPhrase(phrase, onConfirm) {
  const modal = document.getElementById('recovery-modal');
  const display = document.getElementById('recovery-phrase-display');
  const confirmBtn = document.getElementById('recovery-confirm-btn');
  if (!modal || !display || !confirmBtn) { onConfirm(); return; }
  display.textContent = phrase;
  modal.classList.add('open');
  confirmBtn.onclick = () => { modal.classList.remove('open'); onConfirm(); };
}

function switchAuthTab(tab) {
  ['login', 'register', 'recover'].forEach(t => {
    const panel = document.getElementById(`${t}-panel`);
    const btn   = document.getElementById(`tab-${t}`);
    if (panel) panel.style.display = t === tab ? 'flex' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page !== 'auth') return;

  // Redirect if already logged in
  if (getUserSession()) { window.location.href = 'chat.html'; return; }

  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('register-form')?.addEventListener('submit', handleRegister);
  document.getElementById('recover-form')?.addEventListener('submit', handleRecover);

  document.getElementById('tab-login')?.addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tab-register')?.addEventListener('click', () => switchAuthTab('register'));
  document.getElementById('tab-recover')?.addEventListener('click', () => switchAuthTab('recover'));

  switchAuthTab('login');
});
