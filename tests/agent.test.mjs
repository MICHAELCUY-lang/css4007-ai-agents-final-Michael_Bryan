import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {createModelClient} from '../src/model-client.mjs';
import {createStudyTools} from '../src/study-tools.mjs';
import {runStudyAgent, formatToolResults} from '../src/study-agent.mjs';

const run = promisify(execFile);
const root = new URL('../', import.meta.url);
const sample = JSON.parse(await readFile(new URL('../data/week-12.json', import.meta.url), 'utf8'));
const constrained = JSON.parse(await readFile(new URL('../data/over-capacity.json', import.meta.url), 'utf8'));
const range = {start_date: '2026-11-22', end_date: '2026-11-24'};
const toolsFor = data => createStudyTools({loadData: async () => structuredClone(data)});
const call = (name, args = range) => ({name, arguments: args});
const reply = (text, toolCalls = []) => ({text, toolCalls});

async function serveAgent(t, messages) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    const message = messages[requests.length - 1];
    response.writeHead(message ? 200 : 500, {'Content-Type': 'application/json'});
    response.end(JSON.stringify(message ? {done: true, message} : {error: 'Unexpected extra model request'}));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {baseUrl, requests, chat: createModelClient({baseUrl, model: 'test-model'})};
}

test('assignment tool filters deadlines inclusively and calculates actual workload', async () => {
  const result = await toolsFor(sample).execute('list_assignments', {start_date: '2026-11-23', end_date: '2026-11-24'});
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.assignments.map(item => item.id), ['devops-lab', 'ai-reading']);
  assert.equal(result.data.estimated_minutes, 120);
  assert.equal(result.data.complete, true);
});

test('capacity tool distinguishes zero minutes from missing availability', async () => {
  const result = await toolsFor(constrained).execute('get_study_capacity', range);
  assert.equal(result.data.available_minutes, 30);
  assert.deepEqual(result.data.days, [{date: '2026-11-22', minutes: 30}, {date: '2026-11-23', minutes: 0}]);
  assert.deepEqual(result.data.unknown_dates, ['2026-11-24']);
  assert.equal(result.data.complete, false);
});

test('assignment queries outside recorded coverage do not report a complete empty result', async () => {
  const result = await toolsFor(sample).execute('list_assignments', {start_date: '2026-12-01', end_date: '2026-12-02'});
  assert.deepEqual(result.data.assignments, []);
  assert.equal(result.data.complete, false);
  assert.deepEqual(result.data.unknown_dates, ['2026-12-01', '2026-12-02']);
});

test('invalid tool arguments are rejected before loading data', async () => {
  const tools = createStudyTools({loadData: () => assert.fail('Invalid arguments loaded data')});
  for (const args of [null, [], {}, {...range, end_date: '2026-02-30'}, {...range, file: 'secret'}, {start_date: '2026-12-01', end_date: '2027-01-01'}]) {
    const result = await tools.execute('get_study_capacity', args);
    assert.equal(result.error.code, 'INVALID_ARGUMENTS');
  }
});

test('unknown and inherited tool names are never executed', async () => {
  const tools = createStudyTools({loadData: () => assert.fail('Unknown tool loaded data')});
  for (const name of ['delete_files', 'constructor', 'toString', '__proto__']) {
    assert.equal((await tools.execute(name, range)).error.code, 'UNKNOWN_TOOL');
  }
});

test('missing or malformed data returns a tool failure without invented records', async () => {
  for (const loadData of [async () => { throw new Error('private/path'); }, async () => ({})]) {
    const result = await createStudyTools({loadData}).execute('list_assignments', range);
    assert.equal(result.error.code, 'DATA_UNAVAILABLE');
    assert.equal('data' in result, false);
    assert.doesNotMatch(result.error.message, /private\/path/);
  }
});

test('both tools use one validated snapshot within a request', async () => {
  let loads = 0;
  const tools = createStudyTools({loadData: async () => { loads++; return sample; }});
  await tools.execute('list_assignments', range);
  await tools.execute('get_study_capacity', range);
  assert.equal(loads, 1);
});

test('registered tools remain available when the model answers without selecting any', async () => {
  const tools = createStudyTools({loadData: () => assert.fail('General question read task data')});
  const result = await runStudyAgent('How can I stay focused?', {tools, chat: async (messages, definitions) => {
    assert.equal(definitions.length, 2);
    assert.equal(messages[1].content, 'How can I stay focused?');
    return reply('Study in short blocks and silence notifications.');
  }});
  assert.equal(result.tool_calls, 0);
  assert.equal(result.model_rounds, 1);
  assert.equal(formatToolResults(result.trace), '');
});

test('the model selects capacity alone and receives the actual result in an Ollama tool message', async t => {
  const {chat, requests} = await serveAgent(t, [
    {content: '', tool_calls: [{function: {name: 'get_study_capacity', arguments: range}}]},
    {content: 'There are 210 minutes available.'},
  ]);
  const result = await runStudyAgent('How much study time is available?', {chat, tools: toolsFor(sample)});
  assert.equal(result.tool_calls, 1);
  assert.equal(requests[0].tools.length, 2);
  assert.deepEqual(requests[1].messages[2].tool_calls[0].function.arguments, range);
  const toolMessage = requests[1].messages[3];
  assert.equal(toolMessage.role, 'tool');
  assert.equal(toolMessage.tool_name, 'get_study_capacity');
  assert.equal(JSON.parse(toolMessage.content).data.available_minutes, 210);
  assert.deepEqual(result.trace.filter(item => item.type === 'tool_result').map(item => item.name), ['get_study_capacity']);
});

test('the model can select both tools in either order without a hard-coded call sequence', async () => {
  for (const names of [['list_assignments', 'get_study_capacity'], ['get_study_capacity', 'list_assignments']]) {
    let rounds = 0;
    const result = await runStudyAgent('Compare my work and study time.', {tools: toolsFor(sample), chat: async messages => {
      if (!rounds++) return reply('', names.map(name => call(name)));
      const results = messages.filter(item => item.role === 'tool').map(item => JSON.parse(item.content));
      assert.equal(results.length, 2);
      assert.ok(results.every(item => item.ok));
      return reply('210 minutes of work and 210 minutes of available time.');
    }});
    assert.deepEqual(result.trace.filter(item => item.type === 'tool_result').map(item => item.name), names);
    assert.match(formatToolResults(result.trace), /ai-core/);
  }
});

test('invalid arguments are returned to the model and it can correct its next call', async () => {
  let rounds = 0;
  const result = await runStudyAgent('Check my study time.', {tools: toolsFor(sample), chat: async messages => {
    rounds++;
    if (rounds === 1) return reply('', [call('get_study_capacity', {...range, end_date: '2026-02-30'})]);
    if (rounds === 2) {
      assert.equal(JSON.parse(messages.at(-1).content).error.code, 'INVALID_ARGUMENTS');
      return reply('', [call('get_study_capacity')]);
    }
    return reply('The corrected lookup found 210 minutes.');
  }});
  assert.equal(result.tool_calls, 2);
  assert.equal(result.trace.filter(item => item.type === 'tool_result')[0].result.ok, false);
});

test('data unavailability reaches the model and appears in the execution trace', async () => {
  let rounds = 0;
  const result = await runStudyAgent('Look up my tasks.', {
    tools: createStudyTools({loadData: async () => { throw new Error('File unavailable'); }}),
    chat: async messages => {
      if (!rounds++) return reply('', [call('list_assignments')]);
      assert.equal(JSON.parse(messages.at(-1).content).error.code, 'DATA_UNAVAILABLE');
      return reply('The study data is unavailable. Please check the data file.');
    },
  });
  assert.match(result.answer, /unavailable/);
  assert.match(formatToolResults(result.trace), /DATA_UNAVAILABLE/);
});

test('missing-data notes remain visible even when the model omits the warning', async () => {
  let rounds = 0;
  const result = await runStudyAgent('How much study time is available?', {
    tools: toolsFor(constrained), chat: async () => !rounds++
      ? reply('', [call('get_study_capacity')]) : reply('There are 30 known minutes.'),
  });
  assert.equal(result.model_answer, 'There are 30 known minutes.');
  assert.match(result.answer, /Study availability is unknown for: 2026-11-24/);
  assert.match(result.answer, /Totals cover known records only/);
});

test('repeated calls stop at a bounded limit and produce an error event', async () => {
  const events = [];
  await assert.rejects(runStudyAgent('Keep looking up my tasks.', {
    tools: toolsFor(sample), maxRounds: 2, onEvent: event => events.push(event),
    chat: async () => reply('', [call('list_assignments')]),
  }), /limit of 2 model rounds/);
  assert.equal(events.filter(item => item.type === 'tool_result').length, 2);
  assert.equal(events.at(-1).type, 'agent_error');
});

test('excessive parallel calls are rejected before any tool executes', async () => {
  await assert.rejects(runStudyAgent('Look up tasks.', {
    maxToolCalls: 1, tools: {definitions: [], execute: () => assert.fail('Over-budget call executed')},
    chat: async () => reply('', [call('list_assignments'), call('get_study_capacity')]),
  }), /limit of 1 tool calls/);
});

test('blank input, invalid limits, empty answers, and model failures fail clearly', async () => {
  await assert.rejects(runStudyAgent(' '), /Enter a study request/);
  await assert.rejects(runStudyAgent('Help.', {maxRounds: 0}), /Agent limits/);
  await assert.rejects(runStudyAgent('Help.', {chat: async () => reply('')}), /no answer/);
  await assert.rejects(runStudyAgent('Help.', {chat: async () => { throw new Error('Ollama unavailable'); }}), /Ollama unavailable/);
});

test('CLI uses actual file data and writes parseable execution logs', async t => {
  const {baseUrl} = await serveAgent(t, [
    {content: '', tool_calls: [{function: {name: 'list_assignments', arguments: range}}]},
    {content: 'Your three tasks need 210 minutes.'},
  ]);
  const directory = await mkdtemp(join(tmpdir(), 'study-agent-'));
  const traceFile = join(directory, 'trace.jsonl');
  const result = await run(process.execPath, ['src/cli.mjs', '--agent', 'Which assignments are due?', '--data', 'data/week-12.json', '--json', '--trace', traceFile], {
    cwd: root, env: {...process.env, OLLAMA_URL: baseUrl, LLM_MODEL: 'test-model'},
  });
  const output = JSON.parse(result.stdout);
  assert.equal(output.tool_calls, 1);
  assert.equal(output.trace.find(item => item.type === 'tool_result').result.data.estimated_minutes, 210);
  const trace = (await readFile(traceFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(trace.at(-1).type, 'agent_complete');
  assert.ok(!trace.some(item => 'thinking' in item || 'request' in item));
});
