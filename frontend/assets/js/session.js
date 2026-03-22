// session.js — Mychat v9
// Manages the user session stored in localStorage.
'use strict';

const SESSION_KEY = 'v9_session';

function saveUserSession(data) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function getUserSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearUserSession() {
  localStorage.removeItem(SESSION_KEY);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

window.saveUserSession = saveUserSession;
window.getUserSession = getUserSession;
window.clearUserSession = clearUserSession;
window.escHtml = escHtml;
window.showToast = showToast;
window.showModal = showModal;
window.hideModal = hideModal;
