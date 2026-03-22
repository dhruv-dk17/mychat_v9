// dashboard.js — Mychat v9
// Sidebar, contact requests, room management, QR scanner
'use strict';

let acceptedContacts = [];
let incomingRequests = [];
let outgoingRequests = [];
let myRooms = [];
let sidebarView = 'chats';
let activeRoomId = null;
let sharedKeys = {}; // roomId/contact → CryptoKey

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'chat') return;
  const session = getUserSession();
  if (!session) { window.location.href = 'index.html'; return; }

  // Connect Socket.io
  ChatSocket.connect(session.username, session.token);
  ChatSocket.on('connected', () => { showToast('Connected', 'success', 1500); });
  ChatSocket.on('disconnected', () => showToast('Disconnected — reconnecting...', 'warning'));
  ChatSocket.on('contact_request_received', async () => {
    showToast('New contact request!', 'info');
    await refreshDashboard();
  });

  // Presence
  ChatSocket.on('presence', ({ username, status }) => {
    if (username === activeRoomId || acceptedContacts.includes(username)) {
      updatePresenceUI(username, status);
    }
  });

  // Nav buttons
  document.getElementById('nav-chats-btn')?.addEventListener('click', () => setSidebarView('chats'));
  document.getElementById('nav-contacts-btn')?.addEventListener('click', () => setSidebarView('contacts'));
  document.getElementById('nav-settings-btn')?.addEventListener('click', () => setSidebarView('settings'));
  document.getElementById('nav-logout-btn')?.addEventListener('click', logout);

  // New chat button / quick actions
  document.getElementById('sidebar-new-chat')?.addEventListener('click', () => showModal('new-chat-modal'));
  document.getElementById('btn-new-group')?.addEventListener('click', createGroupChat);
  document.getElementById('btn-create-room')?.addEventListener('click', createPermanentRoom);
  document.getElementById('btn-join-room')?.addEventListener('click', joinPermanentRoom);
  document.getElementById('btn-add-contact')?.addEventListener('click', sendContactRequest);

  // QR Scanner
  document.getElementById('btn-scan-qr')?.addEventListener('click', openQrScanner);

  // Sidebar search
  document.getElementById('sidebar-search')?.addEventListener('input', e => renderSidebar(e.target.value.toLowerCase().trim()));

  // Set user avatar
  const av = document.getElementById('nav-avatar');
  if (av) av.textContent = session.username.slice(0,2).toUpperCase();

  await refreshDashboard();
  setSidebarView('chats');

  // Generate/show profile QR
  renderProfileQR(session.username);
});

async function refreshDashboard() {
  const session = getUserSession();
  if (!session) return;
  try {
    const [contactsRes, roomsRes] = await Promise.allSettled([
      fetch(`${CONFIG.API_BASE}/users/contacts?username=${encodeURIComponent(session.username)}&token=${encodeURIComponent(session.token)}`).then(r => r.json()),
      fetch(`${CONFIG.API_BASE}/rooms/mine?username=${encodeURIComponent(session.username)}&token=${encodeURIComponent(session.token)}`).then(r => r.json()),
    ]);
    if (contactsRes.status === 'fulfilled') {
      const d = contactsRes.value;
      acceptedContacts = d.contacts || [];
      incomingRequests = d.incomingRequests || [];
      outgoingRequests = d.outgoingRequests || [];
    }
    if (roomsRes.status === 'fulfilled') myRooms = roomsRes.value.rooms || [];
  } catch (e) { console.warn('Dashboard refresh error:', e); }
  renderSidebar();
  updateHero();
}

function setSidebarView(view) {
  sidebarView = view;
  ['chats','contacts','settings'].forEach(v => {
    document.getElementById(`nav-${v}-btn`)?.classList.toggle('active', v === view);
  });
  const title = document.getElementById('sidebar-section-title');
  if (title) title.textContent = view.charAt(0).toUpperCase() + view.slice(1);
  renderSidebar();
}

function renderSidebar(search = '') {
  const container = document.getElementById('sidebar-chat-list');
  if (!container) return;
  container.innerHTML = '';

  if (sidebarView === 'settings') { renderSettings(container); return; }
  if (sidebarView === 'contacts') { renderContacts(container, search); return; }
  renderChats(container, search);
}

function renderChats(container, search) {
  const filtered = acceptedContacts.filter(c => c.includes(search));
  const filteredRooms = myRooms.filter(r => r.slug.includes(search));

  if (!filtered.length && !filteredRooms.length) {
    container.innerHTML = `<div class="sidebar-empty"><div class="sidebar-empty-mark">💬</div><div>No chats yet. Add a contact to start.</div></div>`;
    return;
  }

  if (filtered.length) {
    container.appendChild(mkHeading('Direct Messages'));
    filtered.forEach(contact => {
      const item = mkListItem(contact.slice(0,2).toUpperCase(), contact, 'Tap to chat');
      item.classList.toggle('active', activeRoomId === contact);
      item.addEventListener('click', () => openDirectChat(contact));
      container.appendChild(item);
    });
  }

  if (filteredRooms.length) {
    container.appendChild(mkHeading('Permanent Rooms'));
    filteredRooms.forEach(room => {
      const item = mkListItem('PR', room.slug, 'Permanent room', 'background:rgba(34,197,94,0.18)');
      item.addEventListener('click', () => openPermanentRoom(room.slug));
      container.appendChild(item);
    });
  }
}

function renderContacts(container, search) {
  const filteredIn  = incomingRequests.filter(c => c.includes(search));
  const filteredOut = outgoingRequests.filter(c => c.includes(search));
  const filteredAcc = acceptedContacts.filter(c => c.includes(search));

  if (filteredIn.length) {
    container.appendChild(mkHeading('Incoming Requests'));
    filteredIn.forEach(username => {
      const card = document.createElement('div');
      card.className = 'sidebar-card';
      card.innerHTML = `
        <div class="chat-list-item-title">${escHtml(username)}</div>
        <div class="sidebar-note">wants to connect</div>
        <div class="sidebar-actions-row">
          <button class="btn btn-primary w-100">Accept</button>
          <button class="btn btn-ghost w-100">Reject</button>
        </div>`;
      const [acc, rej] = card.querySelectorAll('button');
      acc.onclick = () => respondRequest(username, 'accept');
      rej.onclick = () => respondRequest(username, 'reject');
      container.appendChild(card);
    });
  }

  if (filteredOut.length) {
    container.appendChild(mkHeading('Sent Requests'));
    filteredOut.forEach(username => {
      const card = document.createElement('div');
      card.className = 'sidebar-card';
      card.innerHTML = `<div class="chat-list-item-title">${escHtml(username)}</div><span class="sidebar-status-pill">Pending</span>`;
      container.appendChild(card);
    });
  }

  if (filteredAcc.length) {
    container.appendChild(mkHeading('Contacts'));
    filteredAcc.forEach(contact => {
      const item = mkListItem(contact.slice(0,2).toUpperCase(), contact, 'Tap to open chat');
      item.addEventListener('click', () => openDirectChat(contact));
      container.appendChild(item);
    });
  }

  if (!filteredIn.length && !filteredOut.length && !filteredAcc.length) {
    container.innerHTML = `<div class="sidebar-empty"><div class="sidebar-empty-mark">👤</div><div>No contacts yet. Use + to add someone.</div></div>`;
  }
}

function renderSettings(container) {
  const session = getUserSession();
  container.innerHTML = `
    <div class="sidebar-stack">
      <div class="sidebar-card">
        <div class="sidebar-label">Account</div>
        <div class="chat-list-item-title">@${escHtml(session?.username)}</div>
      </div>
      <div class="sidebar-card">
        <div class="sidebar-label">Profile QR</div>
        <div id="settings-qr" style="display:flex;justify-content:center;padding:0.5rem 0;"></div>
      </div>
      <div class="sidebar-actions" style="display:flex;flex-direction:column;gap:0.5rem;padding:0.5rem;">
        <button class="btn btn-ghost w-100" id="settings-scan-qr">Scan Friend QR</button>
        <button class="btn btn-ghost w-100" id="settings-logout">Log Out</button>
        <button class="btn btn-danger-ghost w-100" id="settings-delete">Delete Account</button>
      </div>
    </div>`;

  renderProfileQR(session?.username, 'settings-qr', 120);
  document.getElementById('settings-scan-qr')?.addEventListener('click', openQrScanner);
  document.getElementById('settings-logout')?.addEventListener('click', logout);
  document.getElementById('settings-delete')?.addEventListener('click', deleteAccount);
}

// ── Chat Opening ──────────────────────────────────────────────────────────────
async function openDirectChat(contact) {
  const session = getUserSession();
  if (!session) return;
  activeRoomId = contact;
  const roomId = buildDmRoomId(session.username, contact);

  // Get contact's public key & derive shared secret for E2EE
  if (!sharedKeys[roomId]) {
    try {
      const pkRes = await fetch(`${CONFIG.API_BASE}/users/pubkey/${encodeURIComponent(contact)}?username=${encodeURIComponent(session.username)}&token=${encodeURIComponent(session.token)}`);
      const pkData = await pkRes.json();
      if (pkData.identity_public_key) {
        sharedKeys[roomId] = await Crypto.deriveSharedKey(pkData.identity_public_key);
      }
    } catch (e) { console.warn('Failed to derive shared key:', e); }
  }

  ChatSocket.joinRoom(roomId);
  showChatView(contact, roomId, sharedKeys[roomId]);
  renderSidebar();
}

async function openPermanentRoom(slug) {
  const password = sessionStorage.getItem(`pw_${slug}`) || prompt(`Password for #${slug}:`);
  if (!password) return;

  const res = await fetch(`${CONFIG.API_BASE}/rooms/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, password })
  });
  const data = await res.json();
  if (!data.valid) { showToast('Incorrect password', 'error'); sessionStorage.removeItem(`pw_${slug}`); return; }
  sessionStorage.setItem(`pw_${slug}`, password);
  activeRoomId = slug;
  ChatSocket.joinRoom(slug);
  showChatView(slug, slug, null); // Group rooms: no E2EE shared key (broadcast)
}

function createGroupChat() {
  const session = getUserSession();
  if (!session) return;
  const roomId = 'grp_' + Date.now().toString(36);
  ChatSocket.joinRoom(roomId);
  showChatView(`Group ${roomId}`, roomId, null);
  hideModal('new-chat-modal');
}

async function createPermanentRoom() {
  const slug = document.getElementById('new-room-slug')?.value.trim().toLowerCase();
  const password = document.getElementById('new-room-password')?.value;
  const session = getUserSession();
  if (!slug || !password || !session) return showToast('Fill in room ID and password', 'warning');

  try {
    const res = await fetch(`${CONFIG.API_BASE}/rooms/create?username=${encodeURIComponent(session.username)}&token=${encodeURIComponent(session.token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    sessionStorage.setItem(`pw_${slug}`, password);
    hideModal('new-chat-modal');
    await refreshDashboard();
    openPermanentRoom(slug);
    showToast(`Room #${slug} created`, 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function joinPermanentRoom() {
  const slug = document.getElementById('new-room-slug')?.value.trim().toLowerCase();
  const password = document.getElementById('new-room-password')?.value;
  if (!slug || !password) return showToast('Fill in room ID and password', 'warning');
  hideModal('new-chat-modal');
  sessionStorage.setItem(`pw_${slug}`, password);
  openPermanentRoom(slug);
}

async function sendContactRequest() {
  const input = document.getElementById('new-contact-username');
  const session = getUserSession();
  const target = input?.value.trim().toLowerCase();
  if (!target || !session) return;
  if (target === session.username) return showToast('Cannot add yourself', 'warning');

  try {
    const res = await fetch(`${CONFIG.API_BASE}/users/contacts/request?username=${encodeURIComponent(session.username)}&token=${encodeURIComponent(session.token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactUsername: target })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (input) input.value = '';
    hideModal('new-chat-modal');
    // Notify target via socket
    ChatSocket.notifyContactRequest(target);
    await refreshDashboard();
    setSidebarView('contacts');
    showToast(data.status === 'accepted' ? `@${target} is now a contact` : `Request sent to @${target}`, 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function respondRequest(fromUsername, action) {
  const session = getUserSession();
  if (!session) return;
  try {
    const res = await fetch(`${CONFIG.API_BASE}/users/contacts/respond?username=${encodeURIComponent(session.username)}&token=${encodeURIComponent(session.token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUsername, action })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await refreshDashboard();
    showToast(action === 'accept' ? `Accepted @${fromUsername}` : `Rejected @${fromUsername}`, action === 'accept' ? 'success' : 'info');
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteAccount() {
  if (!confirm('Delete your account permanently?')) return;
  const password = prompt('Enter password to confirm:');
  if (!password) return;
  const session = getUserSession();
  try {
    const res = await fetch(`${CONFIG.API_BASE}/users/account`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: session.username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    clearUserSession();
    window.location.href = 'index.html';
  } catch (e) { showToast(e.message, 'error'); }
}

function logout() {
  ChatSocket.disconnect();
  clearUserSession();
  window.location.href = 'index.html';
}

// ── QR Code ───────────────────────────────────────────────────────────────────
function renderProfileQR(username, containerId = 'profile-qr', size = 160) {
  const container = document.getElementById(containerId);
  if (!container || !username) return;
  try {
    container.innerHTML = '';
    new QRCode(container, {
      text: `mychat://add/${username}`,
      width: size, height: size,
      colorDark: '#00c850', colorLight: '#0d0d16',
    });
  } catch (e) { console.warn('QR render failed:', e); }
}

async function openQrScanner() {
  const modal = document.getElementById('qr-scan-modal');
  if (!modal) return showToast('Scanner not available', 'warning');
  modal.classList.add('open');

  const video = document.getElementById('qr-video');
  if (!video) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    await video.play();

    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const interval = setInterval(async () => {
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          clearInterval(interval);
          stream.getTracks().forEach(t => t.stop());
          modal.classList.remove('open');
          const raw = codes[0].rawValue;
          const match = raw.match(/^mychat:\/\/add\/(.+)$/);
          if (match) {
            document.getElementById('new-contact-username').value = match[1];
            showModal('new-chat-modal');
          } else {
            showToast('Invalid QR code', 'error');
          }
        }
      } catch (_) {}
    }, 400);
  } catch (e) {
    showToast('Camera access denied', 'error');
    modal.classList.remove('open');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildDmRoomId(a, b) {
  return [a, b].map(x => x.toLowerCase()).sort().join(':');
}

function mkHeading(text) {
  const el = document.createElement('div');
  el.className = 'sidebar-label';
  el.style.padding = '0.3rem 0.55rem 0';
  el.textContent = text;
  return el;
}

function mkListItem(avatarText, title, desc, avatarStyle = '') {
  const item = document.createElement('div');
  item.className = 'chat-list-item';
  item.innerHTML = `
    <div class="chat-list-item-avatar" style="${avatarStyle}">${escHtml(avatarText)}</div>
    <div class="chat-list-item-info">
      <div class="chat-list-item-title">${escHtml(title)}</div>
      <div class="chat-list-item-desc">${escHtml(desc)}</div>
    </div>`;
  return item;
}

function updateHero(session = getUserSession()) {
  const title = document.getElementById('dashboard-hero-title');
  const badge1 = document.getElementById('hero-contacts-badge');
  const badge2 = document.getElementById('hero-rooms-badge');
  if (title && session) title.textContent = `Welcome, ${session.username}`;
  if (badge1) badge1.textContent = `${acceptedContacts.length} contacts`;
  if (badge2) badge2.textContent = `${myRooms.length} rooms`;
}

function updatePresenceUI(username, status) {
  const header = document.getElementById('chat-contact-status');
  if (header && activeRoomId === username) {
    header.textContent = status === 'online' ? 'Online' : 'Last seen recently';
    header.style.color = status === 'online' ? '#00c850' : '#888';
  }
}

// showChatView is implemented in chat.js — we expose sharedKeys for it
window.sharedKeys = sharedKeys;
window.buildDmRoomId = buildDmRoomId;
