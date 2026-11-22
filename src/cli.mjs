import {readFile} from 'node:fs/promises';
import {createStudyPlan, formatStudyPlan, planStudy} from './study-planner.mjs';
import {validateStudyData} from './plan-validation.mjs';

const help = `Study Planner Agent
  node src/cli.mjs "Your study question"
  node src/cli.mjs --plan data/week-12.json [--json]
  node src/cli.mjs --check data/week-12.json

--plan creates an AI-prioritized, validated schedule.
--check validates the input file without contacting a model.
Dates are inclusive local calendar days; availability is a daily minute budget.`;

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(help);
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
