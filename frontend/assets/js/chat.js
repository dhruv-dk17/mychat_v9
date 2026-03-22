// chat.js — Mychat v9
// Real-time encrypted chat view: messages, replies, receipts, voice notes, reactions, delete
'use strict';

let currentRoomId = null;
let currentSharedKey = null;
let replyToMsg = null; // { id, sender, preview }
let pendingReadReceipt = [];
let typingTimer = null;
let mediaRecorder = null;
let audioChunks = [];

// Called by dashboard.js when user opens a chat
async function showChatView(displayName, roomId, sharedKey) {
  currentRoomId = roomId;
  currentSharedKey = sharedKey;
  replyToMsg = null;
  pendingReadReceipt = [];

  // Show chat window
  document.getElementById('chat-placeholder').style.display = 'none';
  const chatView = document.getElementById('chat-active-view');
  chatView.style.display = 'flex';
  document.querySelector('.chat-window-column')?.classList.add('active');

  // Populate header
  document.getElementById('chat-contact-name').textContent = displayName;
  document.getElementById('chat-contact-status').textContent = 'Loading...';
  document.getElementById('host-badge').style.display = 'none';

  // Clear old messages
  const feed = document.getElementById('chat-feed');
  feed.innerHTML = '';

  // Load message history
  await loadMessageHistory(roomId);

  // Register Socket events
  ChatSocket.on('message',         onMessage);
  ChatSocket.on('typing_start',    onTypingStart);
  ChatSocket.on('typing_stop',     onTypingStop);
  ChatSocket.on('read_receipt',    onReadReceipt);
  ChatSocket.on('message_deleted', onMessageDeleted);
  ChatSocket.on('react',           onReaction);
  ChatSocket.on('room_online_count', ({ count }) => {
    document.getElementById('online-count').textContent = `${count} online`;
  });
}

// ── Message History ─────────────────────────────────────────────────────────
async function loadMessageHistory(roomId) {
  const session = getUserSession();
  if (!session) return;
  try {
    const res = await fetch(`${CONFIG.API_BASE}/messages/${encodeURIComponent(roomId)}?username=${encodeURIComponent(session.username)}&token=${encodeURIComponent(session.token)}&limit=50`);
    const data = await res.json();
    for (const msg of (data.messages || [])) {
      await renderMessageBubble(msg, false);
    }
    scrollToBottom();
  } catch (e) { console.warn('History load error:', e); }
}

// ── Render Bubble ────────────────────────────────────────────────────────────
async function renderMessageBubble(msg, scroll = true) {
  const session = getUserSession();
  const isMine = msg.sender === session?.username;
  const feed = document.getElementById('chat-feed');
  if (!feed) return;

  const bubble = document.createElement('div');
  bubble.className = `bubble ${isMine ? 'mine' : 'theirs'}`;
  bubble.dataset.msgId = msg.id;

  let content = '';
  if (msg.deleted) {
    content = `<span class="deleted-tombstone">🚫 This message was deleted</span>`;
  } else {
    let plaintext = msg.encrypted_payload;
    if (currentSharedKey && msg.encrypted_payload !== 'DELETED') {
      plaintext = await Crypto.decrypt(currentSharedKey, msg.encrypted_payload);
    }

    // Reply quote
    if (msg.reply_to_id) {
      content += `<div class="reply-quote" data-ref="${msg.reply_to_id}">↩ Quoted message</div>`;
    }

    if (msg.msg_type === 'voice') {
      content += `<audio controls src="${plaintext}" style="max-width:220px;"></audio>`;
    } else {
      content += `<div class="bubble-text">${escHtml(plaintext)}</div>`;
    }
  }

  const readBy = Array.isArray(msg.read_by) ? msg.read_by : [];
  const statusMark = isMine
    ? `<span class="read-tick ${readBy.length > 1 ? 'read' : 'delivered'}">${readBy.length > 1 ? '✓✓' : '✓'}</span>`
    : '';

  bubble.innerHTML = `
    ${!isMine ? `<div class="bubble-sender">${escHtml(msg.sender)}</div>` : ''}
    ${content}
    <div class="bubble-meta">
      <span class="bubble-time">${fmtTime(msg.timestamp)}</span>
      ${statusMark}
    </div>
    <div class="bubble-reactions" id="rxn-${msg.id}"></div>
    <div class="bubble-actions">
      <button class="bac reply-btn" data-id="${msg.id}" title="Reply">↩</button>
      ${isMine ? `<button class="bac delete-btn" data-id="${msg.id}" title="Delete for everyone">🗑</button>` : ''}
      <button class="bac react-btn" data-id="${msg.id}" title="React">😊</button>
    </div>
  `;

  bubble.querySelector('.reply-btn')?.addEventListener('click', () => setReplyTo(msg));
  bubble.querySelector('.delete-btn')?.addEventListener('click', () => deleteMessage(msg.id));
  bubble.querySelector('.react-btn')?.addEventListener('click', (e) => showReactPicker(e, msg.id));

  feed.appendChild(bubble);
  if (scroll) scrollToBottom();

  // Queue read receipt
  if (!isMine && !msg.deleted) {
    pendingReadReceipt.push(msg.id);
    flushReadReceipts();
  }
}

function flushReadReceipts() {
  if (!pendingReadReceipt.length) return;
  ChatSocket.sendReadReceipt(currentRoomId, [...pendingReadReceipt]);
  pendingReadReceipt = [];
}

// ── Send Message ─────────────────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input?.value.trim();
  if (!text || !currentRoomId) return;

  const session = getUserSession();
  if (!session) return;

  input.value = '';
  ChatSocket.sendTypingStop(currentRoomId);

  let payload = text;
  if (currentSharedKey) {
    payload = await Crypto.encrypt(currentSharedKey, text);
  }

  const tempId = ChatSocket.sendMessage(currentRoomId, payload, {
    msgType: 'text',
    replyToId: replyToMsg?.id || null,
  });

  // Optimistic bubble
  const feed = document.getElementById('chat-feed');
  const optimistic = document.createElement('div');
  optimistic.className = 'bubble mine sending';
  optimistic.dataset.tempId = tempId;
  optimistic.innerHTML = `
    <div class="bubble-text">${escHtml(text)}</div>
    <div class="bubble-meta"><span class="bubble-time">${fmtTime()}</span><span class="read-tick">✓</span></div>
  `;
  feed.appendChild(optimistic);
  scrollToBottom();
  clearReplyTo();
}

function setReplyTo(msg) {
  replyToMsg = msg;
  const bar = document.getElementById('reply-bar');
  if (bar) {
    bar.style.display = 'flex';
    document.getElementById('reply-preview').textContent = `↩ ${msg.sender}: (encrypted)`;
  }
}

function clearReplyTo() {
  replyToMsg = null;
  const bar = document.getElementById('reply-bar');
  if (bar) bar.style.display = 'none';
}

function deleteMessage(msgId) {
  if (!confirm('Delete for everyone?')) return;
  ChatSocket.deleteForEveryone(currentRoomId, msgId);
}

// ── Socket Event Handlers ────────────────────────────────────────────────────
async function onMessage(envelope) {
  const session = getUserSession();
  if (envelope.roomId !== currentRoomId) return;

  // Replace optimistic bubble if it's ours
  if (envelope.sender === session?.username) {
    const optimistic = document.querySelector(`[data-temp-id="${envelope.tempId}"]`);
    if (optimistic) { optimistic.remove(); }
  }

  await renderMessageBubble(envelope);
}

function onMessageDeleted({ messageId }) {
  const bubble = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (bubble) {
    const text = bubble.querySelector('.bubble-text');
    if (text) text.outerHTML = `<span class="deleted-tombstone">🚫 This message was deleted</span>`;
    bubble.querySelector('.bubble-actions')?.remove();
  }
}

function onReadReceipt({ reader, messageIds }) {
  messageIds.forEach(id => {
    const tick = document.querySelector(`[data-msg-id="${id}"] .read-tick`);
    if (tick) { tick.textContent = '✓✓'; tick.classList.add('read'); }
  });
}

function onTypingStart({ username }) {
  const indicator = document.getElementById('typing-indicator');
  if (!indicator) return;
  indicator.style.display = 'flex';
  document.getElementById('typing-name').textContent = username;
}

function onTypingStop() {
  document.getElementById('typing-indicator').style.display = 'none';
}

function onReaction({ messageId, encryptedEmoji }) {
  const rxnBar = document.getElementById(`rxn-${messageId}`);
  if (!rxnBar) return;
  const pill = document.createElement('span');
  pill.className = 'reaction-pill';
  pill.textContent = encryptedEmoji; // Group rooms use plain emoji; DMs would decrypt
  rxnBar.appendChild(pill);
}

function showReactPicker(e, msgId) {
  const emojis = ['❤️','😂','😮','😢','👍','🔥'];
  const picker = document.createElement('div');
  picker.className = 'emoji-quick-picker';
  picker.style.cssText = 'position:absolute;background:var(--surface-high);border:1px solid var(--border-dim);border-radius:12px;padding:0.4rem;display:flex;gap:6px;z-index:999;';
  const rect = e.target.getBoundingClientRect();
  picker.style.top = `${rect.top + window.scrollY - 48}px`;
  picker.style.left = `${rect.left}px`;

  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.style.cssText = 'background:none;border:none;font-size:1.3rem;cursor:pointer;padding:2px;';
    btn.onclick = () => {
      ChatSocket.sendReaction(currentRoomId, msgId, emoji);
      picker.remove();
    };
    picker.appendChild(btn);
  });

  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 10);
}

// ── Voice Notes ──────────────────────────────────────────────────────────────
async function toggleVoiceNote() {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = async () => {
        let payload = reader.result; // data URL
        if (currentSharedKey) payload = await Crypto.encrypt(currentSharedKey, payload);
        ChatSocket.sendMessage(currentRoomId, payload, { msgType: 'voice' });
      };
      reader.readAsDataURL(blob);
      document.getElementById('mic-btn').textContent = 'Mic';
    };
    mediaRecorder.start();
    document.getElementById('mic-btn').textContent = '⏹ Stop';
  } catch (e) {
    showToast('Microphone access denied', 'error');
  }
}

// ── Typing indicator ─────────────────────────────────────────────────────────
function onInputKeyup() {
  if (!currentRoomId) return;
  ChatSocket.sendTypingStart(currentRoomId);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => ChatSocket.sendTypingStop(currentRoomId), 1500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function scrollToBottom() {
  const feed = document.getElementById('chat-feed');
  if (feed) feed.scrollTop = feed.scrollHeight;
}

function fmtTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Wire up DOM events ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page !== 'chat') return;

  document.getElementById('send-btn')?.addEventListener('click', sendMessage);
  document.getElementById('msg-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  document.getElementById('msg-input')?.addEventListener('input', onInputKeyup);
  document.getElementById('mic-btn')?.addEventListener('click', toggleVoiceNote);
  document.getElementById('back-btn')?.addEventListener('click', () => {
    document.getElementById('chat-placeholder').style.display = 'flex';
    document.getElementById('chat-active-view').style.display = 'none';
    document.querySelector('.chat-window-column')?.classList.remove('active');
    if (currentRoomId) ChatSocket.leaveRoom(currentRoomId);
    currentRoomId = null;
  });
  document.getElementById('reply-cancel-btn')?.addEventListener('click', clearReplyTo);
});

window.showChatView = showChatView;
