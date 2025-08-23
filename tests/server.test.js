const test = require('node:test');
const assert = require('node:assert');
const { createRoom, server } = require('../src/app.js');

test('createRoom creates a room with a code', (t) => {
  const room = createRoom('test context', 'test prompt');
  assert.strictEqual(typeof room.code, 'string');
  assert.strictEqual(room.code.length, 5);
  assert.strictEqual(room.context, 'test context');
  assert.strictEqual(room.prompt, 'test prompt');
  t.after(() => server.close());
});
