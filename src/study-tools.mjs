import {readFile} from 'node:fs/promises';
import {datesInRange, validateStudyData} from './plan-validation.mjs';

const dateParameters = {
  type: 'object', additionalProperties: false,
  required: ['start_date', 'end_date'],
  properties: {
    start_date: {type: 'string', description: 'Inclusive first date, YYYY-MM-DD.'},
    end_date: {type: 'string', description: 'Inclusive last date, YYYY-MM-DD. At most 31 days after the start, counting both dates.'},
  },
};

export const toolDefinitions = [
  {type: 'function', function: {
    name: 'list_assignments',
    description: 'Read stored assignments due within an inclusive date range. Returns titles, courses, deadlines, estimated minutes, and dates without assignment coverage. Use for questions about actual stored tasks or deadlines, not general study advice.',
    parameters: dateParameters,
  }},
  {type: 'function', function: {
    name: 'get_study_capacity',
    description: 'Read stored available study minutes for an inclusive date range. Returns daily budgets, the exact total, and unknown dates. Use for questions about actual free study time. Missing dates are unknown, not zero.',
    parameters: dateParameters,
  }},
];

const failure = (code, message) => ({ok: false, error: {code, message}});

function validateArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).some(key => !['start_date', 'end_date'].includes(key))) {
    throw new Error('Use only start_date and end_date in YYYY-MM-DD format.');
  }
  return datesInRange(args.start_date, args.end_date);
}

export function createStudyTools({
  dataFile = new URL('../data/week-12.json', import.meta.url),
  loadData = async () => JSON.parse(await readFile(dataFile, 'utf8')),
} = {}) {
  let snapshot;
  async function getData() {
    if (!snapshot) snapshot = structuredClone(validateStudyData(await loadData()));
    return snapshot;
  }
  const handlers = new Map([
    ['list_assignments', (data, args, dates) => {
      const assignments = data.assignments.filter(item => item.deadline >= args.start_date && item.deadline <= args.end_date);
      const unknown = dates.filter(date => date < data.start_date || date > data.end_date);
      return {
        ...args, assignments,
        estimated_minutes: assignments.reduce((total, item) => total + item.estimated_minutes, 0),
        complete: unknown.length === 0, unknown_dates: unknown,
      };
    }],
    ['get_study_capacity', (data, args, dates) => {
      const days = data.availability.filter(item => item.date >= args.start_date && item.date <= args.end_date);
      const known = new Set(days.map(item => item.date));
      const unknown = dates.filter(date => !known.has(date));
      return {
        ...args, days,
        available_minutes: days.reduce((total, item) => total + item.minutes, 0),
        complete: unknown.length === 0, unknown_dates: unknown,
      };
    }],
  ]);
  return {
    definitions: structuredClone(toolDefinitions),
    async execute(name, args) {
      if (!handlers.has(name)) return failure('UNKNOWN_TOOL', 'The requested tool is not registered.');
      let dates;
      try {
        dates = validateArguments(args);
      } catch (error) {
        return failure('INVALID_ARGUMENTS', error.message);
      }
      let data;
      try {
        data = await getData();
      } catch {
        return failure('DATA_UNAVAILABLE', 'Study data could not be loaded or is invalid. Check the data file before retrying.');
      }
      return {ok: true, data: handlers.get(name)(data, args, dates)};
    },
  };
}
