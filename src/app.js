const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
let fetch = require('node-fetch');
const multer = require('multer');
const { getEncoding } = require('js-tiktoken');

if (process.env.NODE_ENV === 'test') {
  fetch = async (url, options) => {
    const urlStr = url.toString();
    if (urlStr.includes('api.openai.com')) {
      if (urlStr.includes('images/generations')) {
        return { ok: true, status: 200, json: async () => ({ data: [{ url: 'http://fake-image.com' }] }) };
      }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Mocked AI response' } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }) };
    }
    throw new Error(`[TEST] Mock fetch called with unexpected URL: ${urlStr}`);
  };
}

const upload = multer({ storage: multer.memoryStorage() });
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

const PRICING = {
  'dall-e-3': {
    'standard': 0.04, // per image
  },
  'gpt-4': {
    'input': 0.03 / 1000, // per 1K tokens
    'output': 0.06 / 1000, // per 1K tokens
  },
  'llama3-8b-8192': {
    'input': 0.00005 / 1000, // per 1K tokens
    'output': 0.00008 / 1000, // per 1K tokens
  }
};

function estimateCost(model, promptTokens, completionTokens) {
  if (!PRICING[model]) {
    return 0;
  }

  if (model === 'dall-e-3') {
    return PRICING[model]['standard'];
  }

  const inputCost = promptTokens * PRICING[model]['input'];
  const outputCost = completionTokens * PRICING[model]['output'];
  return inputCost + outputCost;
}

function logAIInteraction(functionName, details) {
  const { prompt, provider, model, response, error, cost, total_cost } = details;
  let logMessage = `[AI Interaction: ${functionName}]`;

  if (provider) logMessage += `\n  Provider: ${provider}`;
  if (model) logMessage += `\n  Model: ${model}`;
  if (prompt) logMessage += `\n  Prompt: ${prompt.substring(0, 100)}...`;
  if (cost) logMessage += `\n  Estimated Cost: $${cost.toFixed(6)}`;
  if (total_cost) logMessage += `\n  Total World Cost: $${total_cost.toFixed(6)}`;
  if (response) logMessage += `\n  Response: ${JSON.stringify(response).substring(0, 100)}...`;
  if (error) logMessage += `\n  Error: ${error}`;

  console.log(logMessage);
}

function createRoom(world, prompt, ai_settings) {
  const code = generateCode();
  const room = {
    code,
    world: world || {},
    players: new Map(),
    actions: [],
    votes: [],
    context: [{ sender: 'DM', text: world.description || 'Welcome to the adventure!' }],
    prompt: prompt || '',
    ai_settings: ai_settings || { provider: 'openai', apiKey: '' },
    phase: 'SUBMITTING', // Initial phase
    submitted_players: new Set(),
    winningAction: null,
    total_cost: 0,
  };
  rooms.set(code, room);
  return room;
}

app.post('/world/autocomplete', async (req, res) => {
  const { world, ai_settings } = req.body;
  if (!world || !ai_settings) {
    return res.status(400).json({ detail: 'Missing world or ai_settings in request body' });
  }
  try {
    const new_world = await generate_world_details(world, ai_settings);
    res.json(new_world);
  } catch (error) {
    console.error('Error in /world/autocomplete:', error);
    res.status(500).json({ detail: 'An error occurred during auto-complete.', error: error.message });
  }
});

app.post('/world/image', async (req, res) => {
  const { description, artStyle } = req.body;
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ detail: 'The person who deployed this app has not set the OPENAI_API_KEY environment variable.' });
  }
  const prompt = `A landscape in the style of ${artStyle}, representing a world with the following description: "${description}"`;
  const url = 'https://api.openai.com/v1/images/generations';
  const model = 'dall-e-3';
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: '1024x1024'
    })
  };

  try {
    const cost = estimateCost(model);
    logAIInteraction('/world/image', { prompt, model, cost });
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorBody = await response.text();
      logAIInteraction('/world/image', { error: errorBody, model });
      console.error('OpenAI Image API request failed:', errorBody);
      throw new Error(`AI image service failed with status ${response.status}`);
    }
    const data = await response.json();
    logAIInteraction('/world/image', { response: data, model });
    res.json({ imageUrl: data.data[0].url });
  } catch (error) {
    console.error('Error in /world/image:', error);
    res.status(500).json({ detail: 'An error occurred during image generation.', error: error.message });
  }
});

app.post('/room', (req, res) => {
  const { world, prompt, ai_settings } = req.body || {};
  const room = createRoom(world, prompt, ai_settings);
  res.json({ code: room.code });
  // Broadcast context and prompt to all (if any)
  broadcast(room.code, { context: room.context, prompt: room.prompt });
});

async function generateCharacterImage(name, race, imageFile, world) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('The person who deployed this app has not set the OPENAI_API_KEY environment variable.');
  }

  let prompt = `A fantasy character portrait of a ${race}.`;
  if (world && world.artStyle) {
    prompt += ` In the style of ${world.artStyle}.`;
  }
  if (imageFile) {
    prompt += ` The character's appearance should be based on the provided image.`;
  }
  prompt += ` The image should not contain any text.`

  const url = 'https://api.openai.com/v1/images/generations';
  const model = 'dall-e-3';
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: '1024x1024'
    })
  };

  const cost = estimateCost(model);
  logAIInteraction('generateCharacterImage', { prompt, model, cost });

  const response = await fetch(url, options);
  if (!response.ok) {
    const errorBody = await response.text();
    logAIInteraction('generateCharacterImage', { error: errorBody, model });
    console.error('OpenAI Image API request failed:', errorBody);
    throw new Error(`AI image service failed with status ${response.status}`);
  }
  const data = await response.json();
  logAIInteraction('generateCharacterImage', { response: data, model });
  return data.data[0].url;
}

app.post('/room/:code/join', upload.single('image'), async (req, res) => {
  const { code } = req.params;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ detail: 'Invalid room code' });

  const { name, race } = req.body;
  const imageFile = req.file;
  const playerId = generateCode(8);

  try {
    const imageUrl = await generateCharacterImage(name, race, imageFile, room.world);
    const player = {
      id: playerId,
      name,
      character: {
        race,
        imageUrl,
        stats: {
          strength: 10,
          dexterity: 10,
          intelligence: 10,
        },
        inventory: [],
      },
      regenerationAttempts: 0,
    };
    room.players.set(playerId, player);

    const players_obj = Object.fromEntries(room.players);
    broadcast(code, { players: players_obj, phase: room.phase });

    res.json({
      ...player,
      context: room.context,
      prompt: room.prompt,
      phase: room.phase,
    });
  } catch (error) {
    console.error('Error in /room/:code/join:', error);
    res.status(500).json({ detail: 'An error occurred during character creation.', error: error.message });
  }
});

app.post('/room/:code/player/:playerId/regenerate-image', upload.single('image'), async (req, res) => {
  const { code, playerId } = req.params;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ detail: 'Invalid room code' });

  const player = room.players.get(playerId);
  if (!player) return res.status(404).json({ detail: 'Invalid player ID' });

  if (player.regenerationAttempts >= 3) {
    return res.status(400).json({ detail: 'You have reached the maximum number of regeneration attempts.' });
  }

  const imageFile = req.file;

  try {
    const imageUrl = await generateCharacterImage(player.name, player.character.race, imageFile, room.world);
    player.character.imageUrl = imageUrl;
    player.regenerationAttempts++;

    const players_obj = Object.fromEntries(room.players);
    broadcast(code, { players: players_obj, phase: room.phase });

    res.json({
      ...player,
      context: room.context,
      prompt: room.prompt,
      phase: room.phase,
    });
  } catch (error) {
    console.error('Error in /room/:code/player/:playerId/regenerate-image:', error);
    res.status(500).json({ detail: 'An error occurred during image regeneration.', error: error.message });
  }
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

  const player = room.players.get(player_id);
  room.context.push({ sender: player.name, text: text });

  // If all players have submitted, transition to voting phase
  if (room.submitted_players.size === room.players.size && room.players.size > 0) {
    room.phase = 'VOTING';
    // Announce the start of the voting phase and send all actions at once
    broadcast(code, { phase: room.phase, actions: room.actions, context: room.context });
  } else {
    // Broadcast the count of submitted players so others know the status
    broadcast(code, { submitted_count: room.submitted_players.size, players_count: room.players.size, context: room.context });
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

async function generate_world_details(world, ai_settings) {
  const { provider, apiKey } = ai_settings;
  if (!apiKey) {
    throw new Error('Missing API key for selected provider.');
  }
  const prompt = `
    Based on the following partial game world details, expand and fill in the rest of the fields.
    The output should be a single JSON object.

    Partial details:
    ${JSON.stringify(world, null, 2)}

    Please generate a complete world object with the following fields: "name", "description", "genre", "artStyle", "gameMechanics", "winLossConditions".
    If a value is already provided for a field, you can improve it, but you should not override it completely.
  `;

  let url, options;
  const model = provider === 'groq' ? "llama3-8b-8192" : "gpt-4";

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 500
  };

  switch (provider) {
    case 'openai':
      url = 'https://api.openai.com/v1/chat/completions';
      options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      };
      break;
    case 'groq':
      url = 'https://api.groq.com/openai/v1/chat/completions';
       options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      };
      break;
    case 'openrouter':
      url = 'https://openrouter.ai/api/v1/chat/completions';
      options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000', // Required by OpenRouter
          'X-Title': 'VQuest'
        },
        body: JSON.stringify({ ...body, model: 'openai/gpt-4' })
      };
      break;
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }

  const enc = getEncoding('cl100k_base');
  const promptTokens = enc.encode(prompt).length;

  logAIInteraction('generate_world_details', { provider, model, prompt });
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorBody = await response.text();
    logAIInteraction('generate_world_details', { error: errorBody, provider, model });
    console.error(`${provider} API request failed with status ${response.status}:`, errorBody);
    throw new Error(`AI service failed with status ${response.status}`);
  }

  const data = await response.json();
  const completionTokens = data.usage.completion_tokens;
  const cost = estimateCost(model, promptTokens, completionTokens);
  logAIInteraction('generate_world_details', { response: data, cost, provider, model });
  const generated_text = data.choices[0]?.message?.content;

  if (!generated_text) {
    console.error('AI service response did not contain expected text.', JSON.stringify(data, null, 2));
    throw new Error('AI service response was invalid.');
  }

  try {
    // The AI can sometimes return JSON wrapped in markdown, so we strip it.
    const clean_text = generated_text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(clean_text);
  } catch (e) {
    console.error('Failed to parse AI response as JSON:', generated_text);
    throw new Error('AI service returned malformed JSON.');
  }
}

async function generate_story(room, action) {
  const { world, context: story, ai_settings } = room;
  const { provider, apiKey } = ai_settings;
  const story_text = story.map(m => `${m.sender}: ${m.text}`).join('\n');
  const prompt = `
    World: ${JSON.stringify(world, null, 2)}

    Story so far:
    ${story_text}

    The players decided to: "${action}"

    What happens next? Keep your response to 1-3 lines.
  `;

  let url, options;

  switch (provider) {
    case 'openai':
      url = 'https://api.openai.com/v1/chat/completions';
      options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 150
        })
      };
      break;
    case 'groq':
      url = 'https://api.groq.com/openai/v1/chat/completions';
       options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "llama3-8b-8192",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 150
        })
      };
      break;
    case 'openrouter':
      url = 'https://openrouter.ai/api/v1/chat/completions';
      options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000', // Required by OpenRouter
          'X-Title': 'VQuest'
        },
        body: JSON.stringify({
          model: "openai/gpt-4",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 150
        })
      };
      break;
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }

  const model = room.ai_settings.provider === 'groq' ? 'llama3-8b-8192' : 'gpt-4';
  const enc = getEncoding('cl100k_base');
  const promptTokens = enc.encode(prompt).length;

  logAIInteraction('generate_story', { provider, model, prompt });
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorBody = await response.text();
    logAIInteraction('generate_story', { error: errorBody, provider, model });
    console.error(`${provider} API request failed with status ${response.status}:`, errorBody);
    throw new Error(`AI service failed with status ${response.status}`);
  }

  const data = await response.json();
  const completionTokens = data.usage.completion_tokens;
  const cost = estimateCost(model, promptTokens, completionTokens);
  room.total_cost += cost;
  logAIInteraction('generate_story', { response: data, cost, total_cost: room.total_cost, provider, model });
  const generated_text = data.choices[0]?.message?.content;

  if (!generated_text) {
    console.error('AI service response did not contain expected text.', JSON.stringify(data, null, 2));
    throw new Error('AI service response was invalid.');
  }

  return generated_text.trim();
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

    // Add winning action to context
    const winningPlayer = room.players.get(room.winningAction.player_id);
    room.context.push({ sender: 'Game', text: `The party decided to: ${room.winningAction.text}` });


    // 2. AI call
    const new_story = await generate_story(room, room.winningAction.text);
    const prompt = "What do you do now?";
    room.context.push({ sender: 'DM', text: new_story });

    // 3. Update room state for the new round
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
