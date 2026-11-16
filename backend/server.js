import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

app.use(express.json({ limit: '32kb' }));

const players = new Map();
const connections = new Map();

function broadcast(player, excludeConnectionId) {
  const message = JSON.stringify({
    v: 1,
    type: 'entity.update',
    payload: {
      entity_type: 'galaxy',
      entity_id: 'main',
      data: player,
    },
  });

  for (const [connectionId, socket] of connections) {
    if (
      connectionId !== excludeConnectionId &&
      socket.readyState === WebSocket.OPEN
    ) {
      socket.send(message);
    }
  }
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'martins-galaxy-explorer' });
});

app.get('/api/players', (req, res) => {
  const cutoff = Date.now() - 20000;
  const active = [...players.values()].filter(
    player => player.updated_at > cutoff
  );
  res.json({ players: active });
});

app.post('/api/players', (req, res) => {
  const input = req.body || {};

  const id = String(input.id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);

  const name = String(input.name || 'Pilot')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .slice(0, 20) || 'Pilot';

  const values = [input.x, input.y, input.z, input.yaw, input.pitch];

  if (!id || values.some(value => !Number.isFinite(Number(value)))) {
    return res.status(400).json({ error: 'Invalid player telemetry' });
  }

  const player = {
    id,
    name,
    x: Number(input.x),
    y: Number(input.y),
    z: Number(input.z),
    yaw: Number(input.yaw),
    pitch: Number(input.pitch),
    updated_at: Date.now(),
  };

  players.set(id, player);
  broadcast({ ...player, removed: false }, input.connection_id);

  res.json({ ok: true });
});

app.delete('/api/players/:id', (req, res) => {
  const id = String(req.params.id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);

  if (!id) {
    return res.status(400).json({ error: 'Invalid pilot id' });
  }

  players.delete(id);
  broadcast({ id, removed: true });

  res.json({ ok: true });
});

app.post('/api/subscriptions', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/subscriptions/remove', (req, res) => {
  res.json({ ok: true });
});

const voiceMembers = new Map();

function notifyVoiceMembers(message, excludeId) {
  const encoded = JSON.stringify(message);

  for (const [id] of voiceMembers) {
    if (id === excludeId) continue;

    const socket = connections.get(id);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(encoded);
    }
  }
}

wss.on('connection', socket => {
  let connectionId = null;
  let pilotId = '';
  let pilotName = 'PILOT';

  socket.on('message', raw => {
    if (raw.length > 16384) return;

    try {
      const message = JSON.parse(raw.toString());

      if (message.type === 'hello' && message.connection_id) {
        const nextId = String(message.connection_id)
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 64);

        if (!nextId) return;

        const previous = connections.get(nextId);
        if (previous && previous !== socket) {
          voiceMembers.delete(nextId);
          previous.close();
          notifyVoiceMembers({
            type: 'voice.peer-left',
            peer_id: nextId,
          }, nextId);
        }

        connectionId = nextId;
        pilotId = String(message.pilot_id || '')
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 64);
        pilotName = String(message.pilot_name || 'PILOT')
          .replace(/[<>\u0000-\u001f]/g, '')
          .trim()
          .slice(0, 18) || 'PILOT';

        connections.set(connectionId, socket);
        return;
      }

      if (
        !connectionId ||
        connections.get(connectionId) !== socket
      ) return;

      if (message.type === 'voice.join') {
        const peers = [...voiceMembers.entries()]
          .filter(([id]) => (
            id !== connectionId &&
            connections.get(id)?.readyState === WebSocket.OPEN
          ))
          .map(([id, member]) => ({ id, ...member }));

        const member = {
          pilot_id: pilotId,
          name: pilotName,
        };
        voiceMembers.set(connectionId, member);

        socket.send(JSON.stringify({
          type: 'voice.peers',
          peers,
        }));

        notifyVoiceMembers({
          type: 'voice.peer-joined',
          peer: { id: connectionId, ...member },
        }, connectionId);

        return;
      }

      if (message.type === 'voice.leave') {
        if (voiceMembers.delete(connectionId)) {
          notifyVoiceMembers({
            type: 'voice.peer-left',
            peer_id: connectionId,
          }, connectionId);
        }
        return;
      }

      if (
        message.type !== 'voice.signal' ||
        !voiceMembers.has(connectionId)
      ) return;

      const targetId = String(message.target || '');
      if (
        !/^[a-zA-Z0-9_-]{1,64}$/.test(targetId) ||
        targetId === connectionId ||
        !voiceMembers.has(targetId)
      ) return;

      const recipient = connections.get(targetId);
      if (!recipient || recipient.readyState !== WebSocket.OPEN) return;

      const incoming = message.signal;
      if (!incoming || typeof incoming !== 'object') return;

      let signal;

      if (
        (incoming.type === 'offer' || incoming.type === 'answer') &&
        typeof incoming.sdp === 'string' &&
        incoming.sdp.length > 0 &&
        incoming.sdp.length <= 12000
      ) {
        signal = { type: incoming.type, sdp: incoming.sdp };
      } else if (
        incoming.type === 'candidate' &&
        incoming.candidate &&
        typeof incoming.candidate.candidate === 'string' &&
        incoming.candidate.candidate.length <= 4096
      ) {
        const candidate = incoming.candidate;
        signal = {
          type: 'candidate',
          candidate: {
            candidate: candidate.candidate,
            sdpMid: typeof candidate.sdpMid === 'string'
              ? candidate.sdpMid.slice(0, 128) : null,
            sdpMLineIndex: Number.isInteger(candidate.sdpMLineIndex)
              ? candidate.sdpMLineIndex : null,
            ...(typeof candidate.usernameFragment === 'string'
              ? { usernameFragment: candidate.usernameFragment.slice(0, 256) }
              : {}),
          },
        };
      } else if (incoming.type === 'hangup') {
        signal = { type: 'hangup' };
      } else {
        return;
      }

      recipient.send(JSON.stringify({
        type: 'voice.signal',
        from: connectionId,
        signal,
      }));
    } catch {
      // Ignore malformed or invalid signalling messages.
    }
  });

  socket.on('close', () => {
    if (connectionId && connections.get(connectionId) === socket) {
      connections.delete(connectionId);

      if (voiceMembers.delete(connectionId)) {
        notifyVoiceMembers({
          type: 'voice.peer-left',
          peer_id: connectionId,
        }, connectionId);
      }
    }
  });
});
app.use(express.static(dist));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(dist, 'index.html'));
});

const PORT = Number(process.env.PORT || 3001);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Galaxy Explorer server running on port ${PORT}`);
});
