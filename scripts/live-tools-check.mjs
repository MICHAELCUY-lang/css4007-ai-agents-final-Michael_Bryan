import {mkdir, writeFile} from 'node:fs/promises';
import {runStudyAgent} from '../src/study-agent.mjs';
import {createStudyTools} from '../src/study-tools.mjs';
import {defaultModel} from '../src/model-client.mjs';

const baseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const version = await fetch(new URL('/api/version', baseUrl), {signal: AbortSignal.timeout(5_000)});
if (!version.ok) throw new Error('A running Ollama server is required.');
const evidence = {
  checked_at: new Date().toISOString(), model: process.env.LLM_MODEL || defaultModel,
  ollama_version: (await version.json()).version, results: [],
};
const cases = [
  {name: 'assignments-only', request: 'Which assignments are due from 2026-11-22 to 2026-11-24?', expected: ['list_assignments'], minutes: 210},
  {name: 'capacity-only', request: 'How much study time is available from 2026-11-22 to 2026-11-24?', expected: ['get_study_capacity'], minutes: 210},
  {name: 'both-tools', request: 'Compare total estimated assignment work with available study time from 2026-11-22 to 2026-11-24. Report both totals.', expected: ['list_assignments', 'get_study_capacity'], minutes: 210},
  {name: 'both-tools-indonesian', request: 'Bandingkan total beban tugas dan waktu belajar tersedia dari 2026-11-22 sampai 2026-11-24.', expected: ['list_assignments', 'get_study_capacity'], minutes: 210},
  {name: 'general-no-tools', request: 'Give two general tips for staying focused while studying. Do not look up my personal data.', expected: []},
  {name: 'unknown-availability', request: 'How much study time is available from 2026-11-22 to 2026-11-24? Mention dates without data.', expected: ['get_study_capacity'], minutes: 30, file: 'over-capacity', unknown: '2026-11-24'},
];
for (const item of cases) {
  const start = performance.now();
  let result;
  try {
    result = await runStudyAgent(item.request, {tools: createStudyTools({dataFile: new URL(`../data/${item.file || 'week-12'}.json`, import.meta.url)})});
    const calls = result.trace.filter(event => event.type === 'tool_result');
    const actualNames = [...new Set(calls.map(event => event.name))].sort();
    if (JSON.stringify(actualNames) !== JSON.stringify([...item.expected].sort())) throw new Error(`Unexpected tool selection: ${actualNames.join(', ') || '(none)'}.`);
    if (calls.some(event => !event.result.ok)) throw new Error('A live tool call failed.');
    if (item.minutes !== undefined && !new RegExp(`\\b${item.minutes}\\b`).test(result.answer)) throw new Error('The model answer did not include the expected total.');
    if (item.unknown && (!calls.some(event => event.result.data.unknown_dates.includes(item.unknown))
        || !result.answer.includes(item.unknown) || !/unknown|missing|unavailable/i.test(result.answer))) throw new Error('Missing availability was not identified.');
    evidence.results.push({name: item.name, request: item.request, status: 'passed', duration_ms: Math.round(performance.now() - start), ...result});
    console.log(`PASS ${item.name}`);
  } catch (error) {
    evidence.results.push({name: item.name, request: item.request, status: 'failed', duration_ms: Math.round(performance.now() - start), error: error.message, ...(result || {})});
    console.error(`FAIL ${item.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
await mkdir(new URL('../reports/evidence/', import.meta.url), {recursive: true});
await writeFile(new URL('../reports/evidence/week-13-live-tools.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log('Saved reports/evidence/week-13-live-tools.json');
