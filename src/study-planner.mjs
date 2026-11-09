import {complete} from './model-client.mjs';

const systemPrompt = `You are a study planner for university students.
Answer in the user's language. For a scheduling request, suggest short study blocks
using only the assignments, deadlines, estimates, and availability the user supplies.
If a required detail is missing, ask a focused question. Explain when some work
will need more time. Answer general study questions directly and concisely.`;

export async function planStudy(request, chat = complete) {
  if (typeof request !== 'string' || !request.trim() || request.length > 2_000) {
    throw new Error('Enter a study request between 1 and 2,000 characters.');
  }
  const {text, toolCalls} = await chat([
    {role: 'system', content: systemPrompt},
    {role: 'user', content: request.trim()},
  ]);
  if (!text || toolCalls.length) {
    throw new Error('The model did not return a usable study-planning answer.');
  }
  return text;
}
