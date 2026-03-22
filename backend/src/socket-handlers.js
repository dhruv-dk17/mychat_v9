'use strict';
// socket-handlers.js — all Socket.io real-time event handling for v9
// Server is a BLIND RELAY: it never decrypts any payload.

const { pool } = require('./db/database');

const onlineUsers = new Map(); // username → socket.id

module.exports = function attachSocketHandlers(io) {

  io.use((socket, next) => {
    // Lightweight auth: check session_token passed as handshake auth
    const { username, token } = socket.handshake.auth || {};
    if (!username || !token) return next(new Error('Unauthorized'));
    pool.query(
      'SELECT username FROM users WHERE username = $1 AND session_token = $2',
      [username.toLowerCase(), token]
    )
      .then(r => {
        if (!r.rows.length) return next(new Error('Unauthorized'));
        socket.username = r.rows[0].username;
        next();
      })
      .catch(() => next(new Error('Auth error')));
  });

  io.on('connection', (socket) => {
    const me = socket.username;
    onlineUsers.set(me, socket.id);

    // Broadcast online status to all contacts
    broadcastPresence(io, me, 'online');

    // ── JOIN ROOM ──────────────────────────────────────────────────────────
    socket.on('join_room', ({ roomId }) => {
      if (!roomId) return;
      socket.join(roomId);
      socket.to(roomId).emit('user_joined', { username: me, roomId });

      // Send online count for the room
      const count = io.sockets.adapter.rooms.get(roomId)?.size ?? 1;
      io.to(roomId).emit('room_online_count', { roomId, count });
    });

    socket.on('leave_room', ({ roomId }) => {
      if (!roomId) return;
      socket.leave(roomId);
      const count = io.sockets.adapter.rooms.get(roomId)?.size ?? 0;
      io.to(roomId).emit('room_online_count', { roomId, count });
    });

    // ── SEND MESSAGE ───────────────────────────────────────────────────────
    // Relay only — server stores encrypted_payload without decrypting
    socket.on('send_message', async ({ roomId, encryptedPayload, msgType, replyToId, tempId }) => {
      if (!roomId || !encryptedPayload) return;

      try {
        const r = await pool.query(
          `INSERT INTO messages (room_id, sender, encrypted_payload, msg_type, reply_to_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, timestamp`,
          [roomId, me, encryptedPayload, msgType || 'text', replyToId || null]
        );
        const { id, timestamp } = r.rows[0];

        const envelope = {
          id,
          roomId,
          sender: me,
          encryptedPayload,
          msgType: msgType || 'text',
          replyToId: replyToId || null,
          timestamp,
          tempId, // echo back so sender can replace optimistic bubble
          status: 'delivered'
        };

        // Deliver to room (includes sender — sender uses tempId to reconcile)
        io.to(roomId).emit('message', envelope);

        // Mark sent for sender
        socket.emit('message_status', { tempId, id, status: 'sent' });
      } catch (err) {
        console.error('send_message error:', err.message);
        socket.emit('msg_error', { tempId, error: 'Failed to send' });
      }
    });

    // ── READ RECEIPT ───────────────────────────────────────────────────────
    socket.on('read_receipt', async ({ roomId, messageIds }) => {
      if (!roomId || !Array.isArray(messageIds) || !messageIds.length) return;

      try {
        // Update read_by in DB for each message
        for (const msgId of messageIds) {
          await pool.query(
            `UPDATE messages
             SET read_by = (
               SELECT jsonb_agg(DISTINCT val)
               FROM jsonb_array_elements_text(read_by || $1::jsonb) AS val
             )
             WHERE id = $2 AND room_id = $3`,
            [JSON.stringify([me]), msgId, roomId]
          );
        }
        // Notify room members
        socket.to(roomId).emit('read_receipt', { reader: me, messageIds });
      } catch (err) {
        console.error('read_receipt error:', err.message);
      }
    });

    // ── TYPING INDICATOR ──────────────────────────────────────────────────
    socket.on('typing_start', ({ roomId }) => {
      if (roomId) socket.to(roomId).emit('typing_start', { username: me });
    });
    socket.on('typing_stop', ({ roomId }) => {
      if (roomId) socket.to(roomId).emit('typing_stop', { username: me });
    });

    // ── REACTIONS ─────────────────────────────────────────────────────────
    socket.on('react', ({ roomId, messageId, encryptedEmoji }) => {
      if (!roomId || !messageId || !encryptedEmoji) return;
      io.to(roomId).emit('react', { sender: me, messageId, encryptedEmoji });
    });

    // ── DELETE FOR EVERYONE ───────────────────────────────────────────────
    socket.on('delete_for_everyone', async ({ roomId, messageId }) => {
      if (!roomId || !messageId) return;
      try {
        // Only sender or room host can delete
        const r = await pool.query(
          'SELECT sender FROM messages WHERE id = $1 AND room_id = $2',
          [messageId, roomId]
        );
        if (!r.rows.length) return;
        if (r.rows[0].sender !== me) return; // enforce ownership

        await pool.query(
          `UPDATE messages SET deleted = TRUE, encrypted_payload = 'DELETED' WHERE id = $1`,
          [messageId]
        );
        io.to(roomId).emit('message_deleted', { messageId, roomId });
      } catch (err) {
        console.error('delete error:', err.message);
      }
    });

    // ── WEBRTC SIGNALING (voice/video calls) ──────────────────────────────
    socket.on('call_offer', ({ to, offer, roomId }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit('call_offer', { from: me, offer, roomId });
      }
    });
    socket.on('call_answer', ({ to, answer }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) io.to(targetSocket).emit('call_answer', { from: me, answer });
    });
    socket.on('ice_candidate', ({ to, candidate }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) io.to(targetSocket).emit('ice_candidate', { from: me, candidate });
    });
    socket.on('call_end', ({ to }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) io.to(targetSocket).emit('call_end', { from: me });
    });

    // ── CONTACT REQUEST NOTIFICATION ──────────────────────────────────────
    socket.on('notify_contact_request', ({ to }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit('contact_request_received', { from: me });
      }
    });

    // ── DISCONNECT ────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      onlineUsers.delete(me);
      broadcastPresence(io, me, 'offline');
      pool.query('UPDATE users SET last_seen = NOW() WHERE username = $1', [me]).catch(() => {});
    });
  });

  function broadcastPresence(io, username, status) {
    // Emit to all connected sockets (they filter by contacts client-side)
    io.emit('presence', { username, status, ts: new Date().toISOString() });
  }
};
