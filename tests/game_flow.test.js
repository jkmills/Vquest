const assert = require('assert');
const { app, server, createRoom, rooms } = require('../src/app');
const fetch = require('node-fetch');

const PORT = 3001; // Use a different port for testing
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function testHappyPath() {
    console.log('Starting happy-path game flow test...');

    // 1. Create a room
    const room = createRoom('Test context', 'Test prompt');
    const roomCode = room.code;
    assert.strictEqual(room.phase, 'SUBMITTING', 'Initial phase should be SUBMITTING');

    // 2. Simulate two players joining
    const p1res = await fetch(`${BASE_URL}/room/${roomCode}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Player 1' }) });
    const player1 = await p1res.json();
    const p2res = await fetch(`${BASE_URL}/room/${roomCode}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Player 2' }) });
    const player2 = await p2res.json();
    assert.strictEqual(rooms.get(roomCode).players.size, 2, 'Room should have 2 players');

    // 3. Players submit actions
    await fetch(`${BASE_URL}/room/${roomCode}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: player1.id, text: 'Action from Player 1' }) });
    await fetch(`${BASE_URL}/room/${roomCode}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: player2.id, text: 'Action from Player 2' }) });
    assert.strictEqual(rooms.get(roomCode).phase, 'VOTING', 'Phase should be VOTING after all players submit');

    // 4. Players vote
    await fetch(`${BASE_URL}/room/${roomCode}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: player1.id, choice: 1 }) });
    await fetch(`${BASE_URL}/room/${roomCode}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: player2.id, choice: 1 }) });
    assert.strictEqual(rooms.get(roomCode).phase, 'POST_VOTE', 'Phase should be POST_VOTE after all players vote');
    assert.strictEqual(rooms.get(roomCode).winningAction.text, 'Action from Player 2', 'Winning action should be correct');

    // 5. DM advances to the next round (mocking AI)
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
        if (url.toString().includes('edenai')) {
            return { ok: true, status: 200, json: async () => ({ openai: { generated_text: 'A new challenge appears!' } }) };
        }
        return originalFetch(url, options);
    };
    const nextRes = await fetch(`${BASE_URL}/room/${roomCode}/next`, { method: 'POST' });
    const nextData = await nextRes.json();
    assert.strictEqual(nextData.status, 'ok', 'Next step should return ok status');
    global.fetch = originalFetch;

    // 6. Verify game state is reset
    const finalRoomState = rooms.get(roomCode);
    assert.strictEqual(finalRoomState.phase, 'SUBMITTING', 'Phase should reset to SUBMITTING');

    console.log('Happy-path test passed!');
}

async function testAIFailure() {
    console.log('\nStarting AI failure test...');

    // 1. Setup room
    const room = createRoom('AI failure test', 'Test prompt');
    const roomCode = room.code;
    const p1res = await fetch(`${BASE_URL}/room/${roomCode}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Player 1' }) });
    const player1 = await p1res.json();
    await fetch(`${BASE_URL}/room/${roomCode}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: player1.id, text: 'Action 1' }) });
    await fetch(`${BASE_URL}/room/${roomCode}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: player1.id, choice: 0 }) });
    assert.strictEqual(rooms.get(roomCode).phase, 'POST_VOTE', 'Game should be in POST_VOTE phase');

    // 2. Mock the AI call to fail
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
        if (url.toString().includes('edenai')) {
            return { ok: false, status: 500, text: async () => 'AI service is down' };
        }
        return originalFetch(url, options);
    };
    const nextRes = await fetch(`${BASE_URL}/room/${roomCode}/next`, { method: 'POST' });
    global.fetch = originalFetch;

    // 3. Assertions
    assert.strictEqual(nextRes.status, 500, 'Endpoint should return 500 on AI failure');
    const finalRoomState = rooms.get(roomCode);
    assert.strictEqual(finalRoomState.phase, 'POST_VOTE', 'Phase should remain POST_VOTE after a failed /next call');

    console.log('AI failure test passed!');
}

async function runTests() {
    let testServer;
    try {
        // Start server once
        testServer = await new Promise(resolve => {
            const s = app.listen(PORT, '127.0.0.1', () => resolve(s));
        });
        console.log(`Test server running on ${BASE_URL}`);

        // Run all tests
        await testHappyPath();
        await testAIFailure();

        console.log('\nAll tests completed successfully!');
    } catch (error) {
        console.error('\nA test failed:', error);
        process.exit(1);
    } finally {
        // Close server once
        if (testServer) {
            await new Promise(resolve => testServer.close(resolve));
            console.log('\nTest server closed.');
        }
        // Close the main server from app.js as well
        server.close();
    }
}

// Check for node-fetch and run tests
try {
    require.resolve('node-fetch');
    runTests();
} catch (e) {
    console.error('node-fetch not found. Please run "npm install node-fetch@2" to run this test.');
    process.exit(1);
}
