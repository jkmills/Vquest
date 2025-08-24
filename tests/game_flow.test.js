const assert = require('assert');
const { app, server, createRoom, rooms } = require('../src/app');
const fetch = require('node-fetch');

const PORT = 3001; // Use a different port for testing

async function testGameFlow() {
    console.log('Starting game flow test...');

    let testServer;
    try {
        await new Promise(resolve => {
            testServer = app.listen(PORT, '127.0.0.1', () => {
                console.log(`Test server running on http://127.0.0.1:${PORT}`);
                resolve();
            });
        });

        const BASE_URL = `http://127.0.0.1:${PORT}`;

        // 1. Create a room
        const room = createRoom('Test context', 'Test prompt');
        const roomCode = room.code;
        console.log(`Room created with code: ${roomCode}`);
        assert.strictEqual(room.phase, 'SUBMITTING', 'Initial phase should be SUBMITTING');

        // 2. Simulate two players joining
        const player1Res = await fetch(`${BASE_URL}/room/${roomCode}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Player 1' })
        });
        const player1 = await player1Res.json();
        assert.ok(player1.id, 'Player 1 should get an ID');
        console.log('Player 1 joined.');

        const player2Res = await fetch(`${BASE_URL}/room/${roomCode}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Player 2' })
        });
        const player2 = await player2Res.json();
        assert.ok(player2.id, 'Player 2 should get an ID');
        console.log('Player 2 joined.');

        assert.strictEqual(rooms.get(roomCode).players.size, 2, 'Room should have 2 players');

        // 3. Players submit actions
        await fetch(`${BASE_URL}/room/${roomCode}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: player1.id, text: 'Action from Player 1' })
        });
        console.log('Player 1 submitted action.');
        assert.strictEqual(rooms.get(roomCode).phase, 'SUBMITTING', 'Phase should still be SUBMITTING after 1 action');

        await fetch(`${BASE_URL}/room/${roomCode}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: player2.id, text: 'Action from Player 2' })
        });
        console.log('Player 2 submitted action.');
        assert.strictEqual(rooms.get(roomCode).phase, 'VOTING', 'Phase should be VOTING after all players submit');
        assert.strictEqual(rooms.get(roomCode).actions.length, 2, 'There should be 2 actions');

        // 4. Players vote
        // Both vote for Player 2's action (index 1)
        await fetch(`${BASE_URL}/room/${roomCode}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: player1.id, choice: 1 })
        });
        console.log('Player 1 voted.');
        assert.strictEqual(rooms.get(roomCode).phase, 'VOTING', 'Phase should still be VOTING after 1 vote');

        await fetch(`${BASE_URL}/room/${roomCode}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: player2.id, choice: 1 })
        });
        console.log('Player 2 voted.');
        assert.strictEqual(rooms.get(roomCode).phase, 'POST_VOTE', 'Phase should be POST_VOTE after all players vote');
        assert.ok(rooms.get(roomCode).winningAction, 'A winning action should be set');
        assert.strictEqual(rooms.get(roomCode).winningAction.text, 'Action from Player 2', 'Winning action should be correct');

        // 5. DM advances to the next round
        // Mock the AI call to avoid external dependency
        const originalFetch = global.fetch;
        global.fetch = async (url, options) => {
            if (url.toString().includes('edenai')) {
                return {
                    json: async () => ({ openai: { generated_text: 'A new challenge appears!' } })
                };
            }
            return originalFetch(url, options);
        };

        const nextRes = await fetch(`${BASE_URL}/room/${roomCode}/next`, { method: 'POST' });
        const nextData = await nextRes.json();
        assert.strictEqual(nextData.status, 'ok', 'Next step should return ok status');
        console.log('DM advanced to next round.');

        global.fetch = originalFetch; // Restore fetch

        // 6. Verify game state is reset
        const finalRoomState = rooms.get(roomCode);
        assert.strictEqual(finalRoomState.phase, 'SUBMITTING', 'Phase should reset to SUBMITTING');
        assert.strictEqual(finalRoomState.actions.length, 0, 'Actions should be cleared');
        assert.strictEqual(finalRoomState.votes.length, 0, 'Votes should be cleared');
        assert.strictEqual(finalRoomState.submitted_players.size, 0, 'Submitted players should be cleared');
        assert.strictEqual(finalRoomState.winningAction, null, 'Winning action should be cleared');
        assert.ok(finalRoomState.context.includes('A new challenge appears!'), 'Context should be updated with new story');

        console.log('All tests passed!');

    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    } finally {
        if (testServer) {
            testServer.close(() => {
                console.log('Test server closed.');
                // Also close the main server from app.js if it's running, to prevent hanging
                server.close();
            });
        }
    }
}

// Check if node-fetch is available, otherwise install it
try {
    require.resolve('node-fetch');
    testGameFlow();
} catch (e) {
    console.log('node-fetch not found. Please run "npm install node-fetch@2" to run this test.');
    // In a real CI environment, this would be part of package.json
    process.exit(1);
}
