const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json());
app.use(express.static('static'));

// Serve a default player page at root so the app responds to GET /
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'dm.html'));
});

// Simple healthcheck for Render
app.get('/health', (_req, res) => {
  res.sendStatus(200);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();
const clients = new Map();

function generateCode(length = 5) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createRoom() {
  const code = generateCode();
  const room = { code, players: new Map(), actions: [], votes: [] };
  rooms.set(code, room);
  return room;
}

app.post('/room', (req, res) => {
  const room = createRoom();
  res.json({ code: room.code });
});

app.post('/room/:code/join', (req, res) => {
  const { code } = req.params;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ detail: 'Invalid room code' });
  const name = req.body.name;
  const playerId = generateCode(8);
  room.players.set(playerId, name);
  res.json({ id: playerId, name });
});

app.post('/room/:code/action', (req, res) => {
  const { code } = req.params;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ detail: 'Invalid room code' });
  room.actions.push({ player_id: req.body.player_id, text: req.body.text });
  broadcast(code, { actions: room.actions });
  res.json({ status: 'ok' });
});

app.post('/room/:code/vote', (req, res) => {
  const { code } = req.params;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ detail: 'Invalid room code' });
  const choice = req.body.choice;
  if (choice < 0 || choice >= room.actions.length) {
    return res.status(400).json({ detail: 'Invalid choice' });
  }
  room.votes.push({ player_id: req.body.player_id, choice });
  const counts = Array(room.actions.length).fill(0);
  room.votes.forEach(v => counts[v.choice]++);
  broadcast(code, { votes: counts });
  res.json({ status: 'ok' });
});

function broadcast(code, message) {
  const set = clients.get(code);
  if (set) {
    const data = JSON.stringify(message);
    for (const ws of set) {
      ws.send(data);
    }
  }
}

wss.on('connection', (ws, req) => {
  const parts = req.url.split('/');
  const code = parts[parts.length - 1];
  if (!clients.has(code)) clients.set(code, new Set());
  clients.get(code).add(ws);

  ws.on('message', (msg) => {
    broadcast(code, { message: msg.toString() });
  });

  ws.on('close', () => {
    clients.get(code).delete(ws);
  });
});

const port = process.env.PORT || 3000;
// Bind explicitly to 0.0.0.0 for Render's port-binding checks
server.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});
