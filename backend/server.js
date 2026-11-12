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

wss.on('connection', socket => {
  let connectionId = null;

  socket.on('message', raw => {
    try {
      const message = JSON.parse(raw.toString());

      if (message.type === 'hello' && message.connection_id) {
        connectionId = String(message.connection_id);
        connections.set(connectionId, socket);
      }
    } catch {
      // Ignore malformed messages.
    }
  });

  socket.on('close', () => {
    if (connectionId && connections.get(connectionId) === socket) {
      connections.delete(connectionId);
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
