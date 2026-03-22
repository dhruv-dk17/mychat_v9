// chat-socket.js — Mychat v9
// Manages the Socket.io connection and all real-time events.
'use strict';

const ChatSocket = (() => {
  let socket = null;
  const handlers = {};

  function on(event, fn) {
    handlers[event] = handlers[event] || [];
    handlers[event].push(fn);
  }

  function emit(event, data) {
    if (socket?.connected) {
      socket.emit(event, data);
    }
  }

  function connect(username, token) {
    if (socket?.connected) return socket;

    socket = io(CONFIG.WS_URL, {
      auth: { username, token },
      transports: ['websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected', socket.id);
      trigger('connected', {});
    });

    socket.on('disconnect', (reason) => {
      console.warn('[Socket] Disconnected:', reason);
      trigger('disconnected', { reason });
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
      trigger('error', { message: err.message });
    });

    // ── Real-time events forwarded to registered handlers ──────────────────
    const FORWARD = [
      'message', 'message_status', 'msg_error',
      'user_joined', 'room_online_count',
      'typing_start', 'typing_stop',
      'read_receipt',
      'react',
      'message_deleted',
      'presence',
      'contact_request_received',
      'call_offer', 'call_answer', 'ice_candidate', 'call_end',
    ];

    for (const ev of FORWARD) {
      socket.on(ev, (data) => trigger(ev, data));
    }

    return socket;
  }

  function trigger(event, data) {
    (handlers[event] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(`Handler error [${event}]:`, e); } });
  }

  function joinRoom(roomId) { emit('join_room', { roomId }); }
  function leaveRoom(roomId) { emit('leave_room', { roomId }); }

  function sendMessage(roomId, encryptedPayload, options = {}) {
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    emit('send_message', {
      roomId,
      encryptedPayload,
      msgType:   options.msgType   || 'text',
      replyToId: options.replyToId || null,
      tempId,
    });
    return tempId;
  }

  function sendTypingStart(roomId) { emit('typing_start', { roomId }); }
  function sendTypingStop(roomId)  { emit('typing_stop',  { roomId }); }

  function sendReadReceipt(roomId, messageIds) {
    if (!messageIds.length) return;
    emit('read_receipt', { roomId, messageIds });
  }

  function sendReaction(roomId, messageId, encryptedEmoji) {
    emit('react', { roomId, messageId, encryptedEmoji });
  }

  function deleteForEveryone(roomId, messageId) {
    emit('delete_for_everyone', { roomId, messageId });
  }

  function notifyContactRequest(to) { emit('notify_contact_request', { to }); }

  // ── WebRTC signaling helpers ───────────────────────────────────────────────
  function callOffer(to, offer, roomId) { emit('call_offer', { to, offer, roomId }); }
  function callAnswer(to, answer)       { emit('call_answer', { to, answer }); }
  function sendIceCandidate(to, candidate) { emit('ice_candidate', { to, candidate }); }
  function endCall(to) { emit('call_end', { to }); }

  function disconnect() { socket?.disconnect(); socket = null; }
  function isConnected() { return socket?.connected ?? false; }

  return {
    on, connect, disconnect, isConnected,
    joinRoom, leaveRoom,
    sendMessage, sendTypingStart, sendTypingStop, sendReadReceipt,
    sendReaction, deleteForEveryone, notifyContactRequest,
    callOffer, callAnswer, sendIceCandidate, endCall,
  };
})();

window.ChatSocket = ChatSocket;
