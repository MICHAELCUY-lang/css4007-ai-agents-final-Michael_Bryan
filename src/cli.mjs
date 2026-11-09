import {planStudy} from './study-planner.mjs';

try {
  console.log(await planStudy(process.argv.slice(2).join(' ')));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
