# Week 13 tool integration

The tools are registered with Ollama using function names, descriptions, and JSON parameter schemas. The model can return either tool, both, or neither. The program validates and executes only the model-selected calls, appends the assistant's calls and the actual `role: tool` results to the conversation, then asks the model for its answer. The protocol follows [Ollama's tool-calling documentation](https://docs.ollama.com/capabilities/tool-calling).

| Tool | Inputs | Actual result |
| --- | --- | --- |
| `list_assignments` | `start_date`, `end_date` | Tasks due within the range, exact task records, total estimated minutes, and dates outside recorded assignment coverage |
| `get_study_capacity` | `start_date`, `end_date` | Known daily budgets, their sum, and missing dates |

Both dates must be real `YYYY-MM-DD` calendar dates. The inclusive range is at most 31 days. Extra arguments are rejected. Data is loaded lazily, only if a tool is called, and validated using the same schema as `--plan`. Both tools share a snapshot within one request. A general study question can be answered even if the data file is unavailable.

The tools read local JSON. They do not write coursework, modify calendars, or access an external university system. The supplied examples are synthetic. Assignment coverage comes from the file's `start_date` and `end_date`; an empty result outside that window is incomplete. Missing availability is unknown, while a record containing zero minutes is a known day without free time.

## Try it

Run from the repository root with Ollama and the configured model available:

```powershell
node src/cli.mjs --agent "Which assignments are due from 2026-11-22 to 2026-11-24?"
node src/cli.mjs --agent "How much study time is available from 2026-11-22 to 2026-11-24?"
node src/cli.mjs --agent "Bandingkan total beban tugas dan waktu belajar tersedia dari 2026-11-22 sampai 2026-11-24."
node src/cli.mjs --agent "Give two general tips for staying focused while studying. Do not look up my personal data."
node src/cli.mjs --agent "How much study time is available from 2026-11-22 to 2026-11-24?" --data data/over-capacity.json --json
```

Add `--env-file=.env` immediately after `node` when using environment overrides. The tested default is `qwen3:0.6b`. The CLI prints the model's answer followed by exact tool facts. Missing-data notes are derived from tool results and remain visible when the model omits the caveat. JSON output separates `model_answer` from the final `answer` containing these notes.

## Errors and execution records

| Outcome | Behavior |
| --- | --- |
| `INVALID_ARGUMENTS` | Reject invalid dates, ranges, missing fields, and extra arguments before reading the file; send the error to the model |
| `UNKNOWN_TOOL` | Reject any name outside the registry, including inherited object-property names |
| `DATA_UNAVAILABLE` | Send a structured failure when the file is missing or invalid; never manufacture records |
| Repeated calls | Stop after five model rounds or eight calls and record an error |
| Model/API failure | Record the error and exit with a failure status |

Logs use JSON Lines and contain start/completion status, selected calls, returned results or errors, and tool durations. They omit raw user requests and model reasoning. Default logs live in `.private/traces` and are excluded from Git. `--trace` requires a new file to avoid overwriting an existing run. The committed live evidence uses only synthetic data.

## Verification and remaining work

`tests/agent.test.mjs` tests filtering, budgets, unknown coverage, argument validation, file failure, no-tool answers, both call orders, actual Ollama-format messages, correction of invalid arguments, execution limits, and CLI logs. `scripts/live-tools-check.mjs` records model-selected calls and final outputs for six cases, including Indonesian requests.

The initial live comparison request selected only the capacity tool. Clarifying which tool owns each fact led to the final recorded run selecting both. The model can still paraphrase or omit facts on unseen requests. Exact tool records and missing-data notes provide a check; free-text narratives do not receive the strict schedule validation used by `--plan`. Week 14 can refine the agent workflow and connect more natural-language requests to validated scheduling.
