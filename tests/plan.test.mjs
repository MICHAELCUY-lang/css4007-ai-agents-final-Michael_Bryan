import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {createModelClient} from '../src/model-client.mjs';
import {createStudyPlan, formatStudyPlan} from '../src/study-planner.mjs';
import {allocateStudySessions, datesInRange, validatePlan, validateStudyData} from '../src/plan-validation.mjs';

const run = promisify(execFile);
const root = new URL('../', import.meta.url);
const sample = JSON.parse(await readFile(new URL('../data/week-12.json', import.meta.url), 'utf8'));
const constrained = JSON.parse(await readFile(new URL('../data/over-capacity.json', import.meta.url), 'utf8'));
const fullPlan = {sessions: [
  {assignment_id: 'ai-core', date: '2026-11-22', minutes: 60},
  {assignment_id: 'ai-core', date: '2026-11-22', minutes: 30},
  {assignment_id: 'devops-lab', date: '2026-11-23', minutes: 60},
  {assignment_id: 'ai-reading', date: '2026-11-24', minutes: 60},
]};
const oneSession = session => ({sessions: [session]});
const reading = {assignment_id: 'ai-reading', date: '2026-11-24', minutes: 30};

async function servePlan(t, text = JSON.stringify({assignment_order: sample.assignments.map(item => item.id)})) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({done: true, message: {content: text}}));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {requests, baseUrl, chat: createModelClient({baseUrl, model: 'test-model'})};
}

test('structured model request uses the schema, supplied data, and zero temperature', async t => {
  const {chat, requests} = await servePlan(t);
  const plan = await createStudyPlan(sample, chat);
  assert.deepEqual(plan.totals, {
    estimated_minutes: 210, available_minutes: 210, scheduled_minutes: 210, remaining_minutes: 0,
  });
  assert.deepEqual(plan.remaining, []);
  assert.deepEqual(requests[0].format.properties.assignment_order.items.enum, ['ai-core', 'devops-lab', 'ai-reading']);
  assert.equal(requests[0].format.properties.assignment_order.minItems, 3);
  assert.equal(requests[0].format.additionalProperties, false);
  assert.deepEqual(requests[0].options, {temperature: 0});
  assert.equal(requests[0].think, false);
  assert.deepEqual(JSON.parse(requests[0].messages[1].content), sample);
  assert.deepEqual(requests[0].tools, []);
});

test('work that cannot fit remains visible and missing availability is not assumed', () => {
  const plan = validatePlan(oneSession({assignment_id: 'ai-report', date: '2026-11-22', minutes: 30}), constrained);
  assert.equal(plan.totals.remaining_minutes, 120);
  assert.deepEqual(plan.remaining, [
    {assignment_id: 'ai-report', minutes: 60}, {assignment_id: 'reading', minutes: 60},
  ]);
  assert.deepEqual(plan.unknown_dates, ['2026-11-24']);
  const rendered = formatStudyPlan(plan, constrained);
  assert.match(rendered, /AI report: 60 min/);
  assert.match(rendered, /Availability missing \(not used\): 2026-11-24/);
});

test('deadline is inclusive but no session may occur after it', () => {
  assert.equal(validatePlan(oneSession({...reading, assignment_id: 'ai-core', date: '2026-11-22'}), sample).totals.scheduled_minutes, 30);
  assert.throws(() => validatePlan(oneSession({...reading, assignment_id: 'ai-core', date: '2026-11-23'}), sample), /after its deadline/);
});

test('multiple sessions share the daily capacity rather than each getting its own budget', () => {
  assert.throws(() => validatePlan({sessions: [
    {...reading, date: '2026-11-23', minutes: 30},
    {assignment_id: 'devops-lab', date: '2026-11-23', minutes: 60},
  ]}, sample), /exceed available minutes/);
});

test('multiple sessions cannot exceed an assignment estimate', () => {
  assert.throws(() => validatePlan({sessions: [
    {...reading, date: '2026-11-22', minutes: 60},
    {...reading, date: '2026-11-23', minutes: 1},
  ]}, sample), /exceed estimated minutes/);
});

test('unknown dates and explicit zero availability both prevent scheduling', () => {
  assert.throws(() => validatePlan(oneSession({assignment_id: 'reading', date: '2026-11-24', minutes: 1}), constrained), /Availability is unknown/);
  assert.throws(() => validatePlan(oneSession({assignment_id: 'reading', date: '2026-11-23', minutes: 1}), constrained), /exceed available minutes/);
});

test('rejects invented assignments and sessions outside the requested range', () => {
  assert.throws(() => validatePlan(oneSession({...reading, assignment_id: 'invented'}), sample), /Unknown assignment/);
  assert.throws(() => validatePlan(oneSession({...reading, date: '2026-11-21'}), sample), /outside the planning range/);
});

test('rejects malformed model output and unexpected tools', async t => {
  const {chat} = await servePlan(t, '{broken');
  await assert.rejects(createStudyPlan(sample, chat), /invalid priority JSON/);
  await assert.rejects(createStudyPlan(sample, async () => ({text: '{}', toolCalls: [{name: 'invented'}]})), /requested a tool/);
  for (const plan of [null, [], {}, {sessions: 'text'}, {...fullPlan, summary: 'I finished everything'}]) {
    assert.throws(() => validatePlan(plan, sample));
  }
});

test('validates session dates, block lengths, and extra fields', () => {
  for (const minutes of [-1, 0, 1.5, 61, '30', NaN]) {
    assert.throws(() => validatePlan(oneSession({...reading, minutes}), sample), /Session minutes/);
  }
  assert.throws(() => validatePlan(oneSession({...reading, date: '2026-02-30'}), sample), /real calendar date/);
  assert.throws(() => validatePlan(oneSession({...reading, invented: true}), sample), /unknown field/);
});

test('rejects duplicate records to prevent double-counted tasks or availability', () => {
  assert.throws(() => validateStudyData({...sample, assignments: [...sample.assignments, sample.assignments[0]]}), /Duplicate assignment id/);
  assert.throws(() => validateStudyData({...sample, availability: [...sample.availability, sample.availability[0]]}), /Duplicate availability date/);
});

test('validates study data before contacting the model', async () => {
  const failChat = () => assert.fail('Invalid input reached the model');
  for (const data of [
    null, {}, {...sample, assignments: {}}, {...sample, availability: null},
    {...sample, start_date: '2026-02-30'},
    {...sample, assignments: [{...sample.assignments[0], estimated_minutes: -10}]},
    {...sample, assignments: [{...sample.assignments[0], title: ''}]},
    {...sample, availability: [{date: '2026-11-22', minutes: 1441}]},
    {...sample, availability: [{date: '2026-11-25', minutes: 60}]},
  ]) {
    await assert.rejects(createStudyPlan(data, failChat));
  }
});

test('handles leap days, month boundaries, and the maximum planning window', () => {
  assert.deepEqual(datesInRange('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);
  assert.equal(datesInRange('2026-12-01', '2026-12-31').length, 31);
  assert.throws(() => datesInRange('2026-11-24', '2026-11-22'), /chronological order/);
  assert.throws(() => datesInRange('2026-12-01', '2027-01-01'), /1 to 31 days/);
  assert.throws(() => datesInRange('2026-02-29', '2026-03-01'), /real calendar date/);
});

test('empty and past-deadline workloads produce honest remaining totals', () => {
  const empty = validatePlan({sessions: []}, {...sample, assignments: []});
  assert.equal(empty.totals.remaining_minutes, 0);
  assert.match(formatStudyPlan(empty, {...sample, assignments: []}), /No study sessions scheduled/);
  const past = {...sample, assignments: [{...sample.assignments[0], deadline: '2026-11-21'}]};
  assert.equal(validatePlan({sessions: []}, past).totals.remaining_minutes, 90);
  assert.throws(() => validatePlan(oneSession({assignment_id: 'ai-core', date: '2026-11-22', minutes: 30}), past), /after its deadline/);
});

test('CLI validates the example data without a model and prints usage errors', async () => {
  const {stdout} = await run(process.execPath, ['src/cli.mjs', '--check', 'data/week-12.json'], {cwd: root});
  assert.match(stdout, /Input valid: 3 assignments, 3 known days/);
  await assert.rejects(run(process.execPath, ['src/cli.mjs', '--plan'], {cwd: root}), error => error.code === 1 && /--plan/.test(error.stderr));
  await assert.rejects(run(process.execPath, ['src/cli.mjs', '--check', 'missing.json'], {cwd: root}), /Could not read study data/);
});

test('CLI renders a validated model schedule and can emit machine-readable JSON', async t => {
  const {baseUrl} = await servePlan(t);
  const options = {cwd: root, env: {...process.env, OLLAMA_URL: baseUrl, LLM_MODEL: 'test-model'}};
  const {stdout} = await run(process.execPath, ['src/cli.mjs', '--plan', 'data/week-12.json'], options);
  assert.match(stdout, /2026-11-22 \| 60 min \| AI core functionality/);
  assert.match(stdout, /All assignment estimates are scheduled/);
  const jsonResult = await run(process.execPath, ['src/cli.mjs', '--plan', 'data/week-12.json', '--json'], options);
  assert.equal(JSON.parse(jsonResult.stdout).totals.scheduled_minutes, 210);
});

test('CLI does not display a schedule when the model invents an assignment', async t => {
  const {baseUrl} = await servePlan(t, JSON.stringify({assignment_order: ['invented', 'devops-lab', 'ai-reading']}));
  await assert.rejects(run(process.execPath, ['src/cli.mjs', '--plan', 'data/week-12.json'], {
    cwd: root, env: {...process.env, OLLAMA_URL: baseUrl},
  }), error => error.code === 1 && error.stdout === '' && /unknown assignment ID/.test(error.stderr));
});

test('allocator uses model priority for equal deadlines and protects earlier deadlines', () => {
  const data = {
    start_date: '2026-11-22', end_date: '2026-11-23',
    assignments: [
      {id: 'a', title: 'A', course: 'AI', deadline: '2026-11-22', estimated_minutes: 60},
      {id: 'b', title: 'B', course: 'AI', deadline: '2026-11-22', estimated_minutes: 60},
      {id: 'later', title: 'Later', course: 'AI', deadline: '2026-11-23', estimated_minutes: 60},
    ],
    availability: [{date: '2026-11-22', minutes: 60}, {date: '2026-11-23', minutes: 60}],
  };
  const plan = allocateStudySessions(data, ['later', 'b', 'a']);
  assert.deepEqual(plan.sessions, [
    {assignment_id: 'b', date: '2026-11-22', minutes: 60},
    {assignment_id: 'later', date: '2026-11-23', minutes: 60},
  ]);
  assert.deepEqual(plan.remaining, [{assignment_id: 'a', minutes: 60}]);
  assert.equal(data.availability[0].minutes, 60);
});

test('model priority must list all known assignments exactly once', () => {
  for (const order of [null, [], ['ai-core', 'devops-lab'], ['ai-core', 'ai-core', 'ai-reading']]) {
    assert.throws(() => allocateStudySessions(sample, order), /Priority order/);
  }
});

test('allocator supports the full daily budget throughout a 31-day range', () => {
  const data = {
    start_date: '2026-12-01', end_date: '2026-12-31',
    assignments: [{id: 'large', title: 'Large', course: 'Example', deadline: '2026-12-31', estimated_minutes: 44640}],
    availability: datesInRange('2026-12-01', '2026-12-31').map(date => ({date, minutes: 1440})),
  };
  const plan = allocateStudySessions(data, ['large']);
  assert.equal(plan.sessions.length, 744);
  assert.equal(plan.totals.remaining_minutes, 0);
});

test('an empty workload does not need a model call', async () => {
  const plan = await createStudyPlan({...sample, assignments: []}, () => assert.fail('Empty workload reached the model'));
  assert.equal(plan.totals.scheduled_minutes, 0);
});
