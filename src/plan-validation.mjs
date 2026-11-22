const maxDays = 31;

export const planSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sessions'],
  properties: {
    sessions: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['assignment_id', 'date', 'minutes'],
        properties: {
          assignment_id: {type: 'string'},
          date: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'},
          minutes: {type: 'integer', minimum: 1, maximum: 60},
        },
      },
    },
  },
};

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function requireText(value, label, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be nonempty text of at most ${maxLength} characters.`);
  }
}

function requireMinutes(value, label, maximum, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
}

export function validateDate(value, label = 'Date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || value < '2000-01-01' || value > '2100-12-31'
      || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real calendar date in YYYY-MM-DD format (2000-2100).`);
  }
  return value;
}

export function datesInRange(start, end) {
  validateDate(start, 'start_date');
  validateDate(end, 'end_date');
  const count = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
  if (count < 1 || count > maxDays) {
    throw new Error(`The date range must contain 1 to ${maxDays} days in chronological order.`);
  }
  return Array.from({length: count}, (_, i) => new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10));
}

export function validateStudyData(data) {
  requireObject(data, 'Study data');
  const dates = datesInRange(data.start_date, data.end_date);
  if (!Array.isArray(data.assignments) || data.assignments.length > 100) {
    throw new Error('assignments must be an array of at most 100 records.');
  }
  const ids = new Set();
  for (const item of data.assignments) {
    requireObject(item, 'Assignment');
    requireText(item.id, 'Assignment id', 80);
    requireText(item.title, 'Assignment title');
    requireText(item.course, 'Assignment course');
    validateDate(item.deadline, 'Assignment deadline');
    requireMinutes(item.estimated_minutes, 'Assignment estimated_minutes', maxDays * 1440, 1);
    if (ids.has(item.id)) throw new Error(`Duplicate assignment id: ${item.id}.`);
    ids.add(item.id);
  }
  if (!Array.isArray(data.availability) || data.availability.length > maxDays) {
    throw new Error(`availability must be an array of at most ${maxDays} daily records.`);
  }
  const knownDays = new Set();
  for (const item of data.availability) {
    requireObject(item, 'Availability record');
    validateDate(item.date, 'Availability date');
    requireMinutes(item.minutes, 'Availability minutes', 1440);
    if (!dates.includes(item.date)) throw new Error(`Availability date ${item.date} is outside the planning range.`);
    if (knownDays.has(item.date)) throw new Error(`Duplicate availability date: ${item.date}.`);
    knownDays.add(item.date);
  }
  return data;
}

export function validatePlan(plan, data) {
  validateStudyData(data);
  requireObject(plan, 'Plan');
  if (Object.keys(plan).some(key => key !== 'sessions')
      || !Array.isArray(plan.sessions) || plan.sessions.length > 500) {
    throw new Error('Plan must contain only a sessions array with at most 500 entries.');
  }
  const assignments = new Map(data.assignments.map(item => [item.id, item]));
  const dailyLimits = new Map(data.availability.map(item => [item.date, item.minutes]));
  const usedByDate = new Map();
  const usedByAssignment = new Map();
  for (const session of plan.sessions) {
    requireObject(session, 'Session');
    if (Object.keys(session).some(key => !['assignment_id', 'date', 'minutes'].includes(key))) {
      throw new Error('Session contains an unknown field.');
    }
    const assignment = assignments.get(session.assignment_id);
    if (!assignment) throw new Error(`Unknown assignment: ${session.assignment_id}.`);
    validateDate(session.date, 'Session date');
    requireMinutes(session.minutes, 'Session minutes', 60, 1);
    if (session.date < data.start_date || session.date > data.end_date) {
      throw new Error(`Session date ${session.date} is outside the planning range.`);
    }
    if (session.date > assignment.deadline) {
      throw new Error(`Session for ${assignment.id} is after its deadline.`);
    }
    if (!dailyLimits.has(session.date)) {
      throw new Error(`Availability is unknown for ${session.date}.`);
    }
    const dailyTotal = (usedByDate.get(session.date) ?? 0) + session.minutes;
    if (dailyTotal > dailyLimits.get(session.date)) {
      throw new Error(`Sessions exceed available minutes on ${session.date}.`);
    }
    const assignmentTotal = (usedByAssignment.get(assignment.id) ?? 0) + session.minutes;
    if (assignmentTotal > assignment.estimated_minutes) {
      throw new Error(`Sessions exceed estimated minutes for ${assignment.id}.`);
    }
    usedByDate.set(session.date, dailyTotal);
    usedByAssignment.set(assignment.id, assignmentTotal);
  }
  const remaining = data.assignments.map(item => ({
    assignment_id: item.id,
    minutes: item.estimated_minutes - (usedByAssignment.get(item.id) ?? 0),
  })).filter(item => item.minutes > 0);
  return {
    start_date: data.start_date,
    end_date: data.end_date,
    sessions: [...plan.sessions].sort((a, b) => a.date.localeCompare(b.date)),
    totals: {
      estimated_minutes: data.assignments.reduce((sum, item) => sum + item.estimated_minutes, 0),
      available_minutes: data.availability.reduce((sum, item) => sum + item.minutes, 0),
      scheduled_minutes: plan.sessions.reduce((sum, item) => sum + item.minutes, 0),
      remaining_minutes: remaining.reduce((sum, item) => sum + item.minutes, 0),
    },
    remaining,
    unknown_dates: datesInRange(data.start_date, data.end_date).filter(date => !dailyLimits.has(date)),
  };
}
