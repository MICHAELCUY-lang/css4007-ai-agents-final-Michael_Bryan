import {readFile, mkdir, open} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import {createStudyPlan, formatStudyPlan, planStudy} from './study-planner.mjs';
import {validateStudyData} from './plan-validation.mjs';
import {runStudyAgent, formatToolResults} from './study-agent.mjs';
import {createStudyTools} from './study-tools.mjs';

const help = `Study Planner Agent
  node src/cli.mjs "Your study question"
  node src/cli.mjs --plan data/week-12.json [--json]
  node src/cli.mjs --check data/week-12.json
  node src/cli.mjs --agent "Your question with YYYY-MM-DD dates" [--data file.json] [--json] [--trace file.jsonl]

--plan creates an AI-prioritized, validated schedule.
--check validates the input file without contacting a model.
--agent lets the LLM select and execute assignment/capacity tools, or answer directly.
Dates are inclusive local calendar days; availability is a daily minute budget.`;

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(help);
  } else if (args[0] === '--agent') {
    const request = args[1];
    if (!request || request.startsWith('--')) throw new Error(help);
    let dataFile, json = false, traceFile;
    const seen = new Set();
    for (let i = 2; i < args.length; i++) {
      const flag = args[i];
      if (seen.has(flag)) throw new Error(help);
      seen.add(flag);
      if (flag === '--json') json = true;
      else if (['--data', '--trace'].includes(flag) && args[i + 1] && !args[i + 1].startsWith('--')) {
        if (flag === '--data') dataFile = args[++i];
        else traceFile = args[++i];
      } else throw new Error(help);
    }
    traceFile ??= `.private/traces/${randomUUID()}.jsonl`;
    await mkdir(dirname(traceFile), {recursive: true});
    const log = await open(traceFile, 'wx');
    try {
      const result = await runStudyAgent(request, {
        tools: createStudyTools(dataFile ? {dataFile} : {}),
        onEvent: event => log.writeFile(JSON.stringify(event) + '\n'),
      });
      if (json) console.log(JSON.stringify({...result, trace_file: traceFile}, null, 2));
      else {
        console.log(result.answer);
        const facts = formatToolResults(result.trace);
        if (facts) console.log('\nVerified tool results:\n' + facts);
      }
    } finally {
      await log.close();
      console.error(`Trace: ${traceFile}`);
    }
  } else if (['--plan', '--check'].includes(args[0])) {
    const [mode, file, output] = args;
    if (!file || file.startsWith('--') || args.length > 3
        || (output && (mode !== '--plan' || output !== '--json'))) {
      throw new Error(help);
    }
    let data;
    try {
      data = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      throw new Error(`Could not read study data from ${file}: ${error.message}`, {cause: error});
    }
    validateStudyData(data);
    if (mode === '--check') {
      console.log(`Input valid: ${data.assignments.length} assignments, ${data.availability.length} known days (${data.start_date} to ${data.end_date}).`);
    } else {
      const plan = await createStudyPlan(data);
      console.log(output === '--json' ? JSON.stringify(plan, null, 2) : formatStudyPlan(plan, data));
    }
  } else {
    if (args.some(arg => arg.startsWith('--'))) throw new Error(help);
    console.log(await planStudy(args.join(' ')));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
