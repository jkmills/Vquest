const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'static')));

// Serve a default player page at root so the app responds to GET /
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'static', 'dm.html'));
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

function createRoom(context, prompt) {
  const code = generateCode();
  const room = {
    code,
    players: new Map(),
    actions: [],
    votes: [],
    quest_context: context || '',
    context: context || '',
    prompt: prompt || '',
    phase: 'SUBMITTING', // Initial phase
    submitted_players: new Set(),
    winningAction: null,
  };
  rooms.set(code, room);
  return room;
}

app.post('/room', (req, res) => {
  const { context, prompt } = req.body || {};
  const room = createRoom(context, prompt);
  res.json({ code: room.code });
  // Broadcast context and prompt to all (if any)
  broadcast(room.code, { context: room.context, prompt: room.prompt });
});

app.post('/room/:code/join', (req, res) => {
  const { code } = req.params;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ detail: 'Invalid room code' });
  const name = req.body.name;
  const playerId = generateCode(8);
  const player = {
    id: playerId,
    name,
    character: {
      stats: {
        strength: 10,
        dexterity: 10,
        intelligence: 10,
      },
      inventory: [],
    },
  };
  room.players.set(playerId, player);

  // Convert Map to object for JSON serialization
  const players_obj = Object.fromEntries(room.players);

  broadcast(code, { players: players_obj, phase: room.phase });
  res.json({
    ...player,
    context: room.context,
    prompt: room.prompt,
    phase: room.phase,
  });
});

app.post('/room/:code/action', (req, res) => {
  const { code } = req.params;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ detail: 'Invalid room code' });

  // Players can only submit actions during the SUBMITTING phase
  if (room.phase !== 'SUBMITTING') {
    return res.status(400).json({ detail: 'Not in submission phase.' });
  }

  const { player_id, text } = req.body;

  // Check if player has already submitted
  if (room.submitted_players.has(player_id)) {
    return res.status(400).json({ detail: 'You have already submitted an action.' });
  }

  room.actions.push({ player_id, text });
  room.submitted_players.add(player_id);

  // If all players have submitted, transition to voting phase
  if (room.submitted_players.size === room.players.size && room.players.size > 0) {
    room.phase = 'VOTING';
    // Announce the start of the voting phase and send all actions at once
    broadcast(code, { phase: room.phase, actions: room.actions });
  } else {
    // Broadcast the count of submitted players so others know the status
    broadcast(code, { submitted_count: room.submitted_players.size, players_count: room.players.size });
  }

  res.json({ status: 'ok' });
});

app.post('/room/:code/vote', (req, res) => {
  const { code } = req.params;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ detail: 'Invalid room code' });

  // Players can only vote during the VOTING phase
  if (room.phase !== 'VOTING') {
    return res.status(400).json({ detail: 'Not in voting phase.' });
  }

  const { player_id, choice } = req.body;
  if (room.votes.some(v => v.player_id === player_id)) {
    return res.status(400).json({ detail: 'You have already voted.' });
  }

  if (choice < 0 || choice >= room.actions.length) {
    return res.status(400).json({ detail: 'Invalid choice' });
  }
  room.votes.push({ player_id, choice });

  const counts = Array(room.actions.length).fill(0);
  room.votes.forEach(v => counts[v.choice]++);

  // Check if all players have voted
  if (room.votes.length === room.players.size) {
    room.phase = 'POST_VOTE';
    const winningIndex = counts.indexOf(Math.max(...counts));
    room.winningAction = room.actions[winningIndex];
    // Broadcast final votes and winning action to all clients
    broadcast(code, { phase: room.phase, votes: counts, winningAction: room.winningAction });
  } else {
    // Just broadcast the current vote counts
    broadcast(code, { votes: counts });
  }

  res.json({ status: 'ok' });
});

// Get your Eden AI API key from https://app.edenai.run/user/register
const EDEN_AI_API_KEY = process.env.EDEN_AI_API_KEY || 'YOUR_API_KEY';

async function generate_story(quest_context, story, action) {
  const options = {
    method: 'POST',
    headers: {
      authorization: `Bearer ${EDEN_AI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      response_as_dict: true,
      attributes_as_list: false,
      show_original_response: false,
      temperature: 0.7,
      max_tokens: 150,
      providers: 'openai',
      text: `Quest: ${quest_context}\n\nStory so far: ${story}\n\nThe players decided to: "${action}"\n\nWhat happens next?`,
      fallback_providers: ""
    })
  };

  const response = await fetch('https://api.edenai.run/v2/text/generation', options);
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Eden AI API request failed with status ${response.status}:`, errorBody);
    throw new Error(`AI service failed with status ${response.status}`);
  }

  const data = await response.json();
  const generated_text = data?.openai?.generated_text;

  if (!generated_text) {
    console.error('AI service response did not contain expected text.', JSON.stringify(data, null, 2));
    throw new Error('AI service response was invalid.');
  }

  return generated_text;
}

app.post('/room/:code/next', async (req, res) => {
  const { code } = req.params;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ detail: 'Invalid room code' });

  if (room.phase !== 'POST_VOTE') {
    return res.status(400).json({ detail: 'Not ready for the next step. Voting is not complete.' });
  }

  try {
    // 1. Winning action is already determined and stored in room.winningAction
    if (!room.winningAction) {
        return res.status(400).json({ detail: 'No winning action found.' });
    }

    // 2. AI call
    const new_story = await generate_story(room.quest_context, room.context, room.winningAction.text);
    const prompt = "What do you do now?";

    // 3. Update room state for the new round
    room.context += `\n\n${new_story}`;
    room.prompt = prompt;
    room.actions = [];
    room.votes = [];
    room.submitted_players.clear();
    room.phase = 'SUBMITTING'; // Reset for the next round
    room.winningAction = null; // Clear winner for the new round

    // 4. Broadcast new state
    broadcast(code, {
      context: room.context,
      prompt: room.prompt,
      actions: room.actions,
      votes: room.votes,
      phase: room.phase,
      winningAction: null
    });
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error in /room/:code/next:', error);
    res.status(500).json({ detail: 'An error occurred while advancing the game.', error: error.message });
  }
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

module.exports = { app, server, createRoom, rooms };
