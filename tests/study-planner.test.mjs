import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import test from 'node:test';
import {createModelClient} from '../src/model-client.mjs';
import {planStudy} from '../src/study-planner.mjs';

async function serveChat(t, reply) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      url: request.url,
      method: request.method,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    response.writeHead(reply.status ?? 200, {'Content-Type': 'application/json'});
    response.end(reply.body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const chat = createModelClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    model: 'test-model',
  });
  return {chat, requests};
}

function chatReply(message) {
  return {body: JSON.stringify({done: true, message})};
}

test('sends system and user messages to Ollama and returns the answer', async t => {
  const {chat, requests} = await serveChat(t, chatReply({content: ' Read for 25 minutes. '}));
  assert.equal(await planStudy('  Help me study tonight.  ', chat), 'Read for 25 minutes.');
  assert.equal(requests.length, 1);
  const [{url, method, body}] = requests;
  assert.equal(url, '/api/chat');
  assert.equal(method, 'POST');
  assert.equal(body.model, 'test-model');
  assert.equal(body.stream, false);
  assert.match(body.messages[0].content, /study planner/);
  assert.deepEqual(body.messages[1], {role: 'user', content: 'Help me study tonight.'});
});

test('rejects blank requests before calling the model', async () => {
  await assert.rejects(planStudy('  ', () => assert.fail('Model called')), /Enter a study request/);
});

test('rejects oversized requests before calling the model', async () => {
  await assert.rejects(planStudy('x'.repeat(2_001), () => assert.fail('Model called')), /2,000 characters/);
});

test('rejects an empty model answer', async t => {
  const {chat} = await serveChat(t, chatReply({content: '  '}));
  await assert.rejects(planStudy('Help me study.', chat), /usable study-planning answer/);
});

test('reports the missing model with a setup hint', async t => {
  const {chat} = await serveChat(t, {status: 404, body: '{"error":"model not found"}'});
  await assert.rejects(planStudy('Help me study.', chat), /HTTP 404.*ollama pull/);
});

test('handles invalid JSON from Ollama', async t => {
  const {chat} = await serveChat(t, {body: 'broken'});
  await assert.rejects(planStudy('Help me study.', chat), /invalid JSON/);
});

test('rejects an incomplete model reply', async t => {
  const {chat} = await serveChat(t, {body: '{"done":false,"message":{"content":"Partial"}}'});
  await assert.rejects(planStudy('Help me study.', chat), /incomplete or malformed/);
});

test('rejects an unsolicited tool call in the Week 11 workflow', async t => {
  const {chat} = await serveChat(t, chatReply({
    content: '',
    tool_calls: [{function: {name: 'list_assignments', arguments: {}}}],
  }));
  await assert.rejects(planStudy('What is due?', chat), /usable study-planning answer/);
});
