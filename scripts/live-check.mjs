import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createStudyPlan, planStudy} from '../src/study-planner.mjs';
import {defaultModel} from '../src/model-client.mjs';

const baseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const model = process.env.LLM_MODEL || defaultModel;
const evidence = {checked_at: new Date().toISOString(), model, results: []};
try {
  const response = await fetch(new URL('/api/version', baseUrl), {signal: AbortSignal.timeout(5_000)});
  if (!response.ok) throw new Error(`Ollama version check returned HTTP ${response.status}.`);
  evidence.ollama_version = (await response.json()).version;
} catch (error) {
  console.error(`Live check needs a running Ollama server: ${error.message}`);
  process.exit(1);
}

const cases = [
  ['general-question', () => planStudy('Bagaimana membagi waktu belajar selama 60 menit agar tetap fokus? Jawab singkat.')],
  ...['week-12', 'over-capacity'].map(name => [name, async () => {
    const data = JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
    return createStudyPlan(data);
  }, output => {
    const expected = name === 'week-12' ? 210 : 30;
    if (output.totals.scheduled_minutes !== expected) {
      throw new Error(`Expected ${expected} scheduled minutes for this fixture; received ${output.totals.scheduled_minutes}.`);
    }
  }]),
];
for (const [name, execute, verify] of cases) {
  const start = performance.now();
  let output;
  try {
    output = await execute();
    verify?.(output);
    evidence.results.push({name, status: 'passed', duration_ms: Math.round(performance.now() - start), output});
    console.log(`PASS ${name}`);
  } catch (error) {
    evidence.results.push({name, status: 'failed', duration_ms: Math.round(performance.now() - start), error: error.message, ...(output === undefined ? {} : {output})});
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}
const destination = new URL('../reports/evidence/week-12-live.json', import.meta.url);
await mkdir(new URL('./', destination), {recursive: true});
await writeFile(destination, JSON.stringify(evidence, null, 2) + '\n');
console.log('Saved reports/evidence/week-12-live.json');
