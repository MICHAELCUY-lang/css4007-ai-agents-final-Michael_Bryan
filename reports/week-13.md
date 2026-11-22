# Semester Week 13 Progress Report

## Completed Work

Prepared the Week 13 tool-integration milestone early on November 22, 2026. Its scheduled reporting window is November 23-29; this report records the actual preparation date and does not establish activity during that future window. Implemented two model-callable tools, native Ollama tool-call execution, result messages returned to the model, execution logs, and the `--agent` CLI mode.

## Important Commits

- [`43fd995c593316e8cb654e741cdf04224a033285`](https://github.com/MICHAELCUY-lang/css4007-ai-agents-final-Michael_Bryan/commit/43fd995c593316e8cb654e741cdf04224a033285): Integrate model-selected assignment and capacity tools, add 17 application tests, record live tool-selection traces, and document the protocol.

## Current Functionality

`list_assignments(start_date, end_date)` reads tasks due within an inclusive range and returns exact records, total workload, and unknown assignment coverage. `get_study_capacity(start_date, end_date)` returns known daily budgets, their total, and missing dates. Both tools read a validated local JSON snapshot. The LLM selects either tool, both, or neither; the application does not match request keywords to a fixed call sequence.

`--agent` sends real tool results or structured errors back to the model, prints its answer with exact tool facts, and writes JSON Lines events to `.private/traces`. Missing-data notes are added from tool results even when the model omits them. The separate `--plan` command continues to produce validated schedules. The tested default is `qwen3:0.6b` through local Ollama 0.40.17. The example records remain synthetic.

## Problems Encountered

The initial live comparison request selected only the capacity tool, although both workload and capacity were requested. The small model can also paraphrase assignment titles and omit missing-data caveats. Empty data outside known coverage must not be presented as a complete lookup. The 4B model download was interrupted; it was not used for the recorded checks.

## Solutions

Clarified that workload and free time belong to different tools. Added explicit date/range validation, rejection of unknown tool names, structured data-load errors, and a five-round/eight-call limit. Results are returned with Ollama `role: tool` messages and tool names. The CLI includes exact records and independently derived unknown-data notes. Logs omit raw user requests and model reasoning, and default logs are excluded from Git.

All 57 automated tests passed: 47 application tests and 10 inherited starter tests. The 17 new tests cover both tools, filtering, validation, missing files, snapshots, no-tool responses, both call orders, actual HTTP message format, argument correction, execution limits, missing-data notes, and CLI logs. See [test output](evidence/week-13-tests.txt).

All six final live cases passed with actual model-selected calls: assignments only, capacity only, both tools in English, both in Indonesian, general advice without tools, and unknown availability. The normal fixtures return 210 minutes; the constrained fixture returns 30 known minutes and identifies November 24 as unknown. See [initial traces](evidence/week-13-live-tools-initial.json), [final traces](evidence/week-13-live-tools.json), and the [integration guide](../docs/tool-integration.md). These checks verify selected tool sets, returned success/data, expected totals, and visible missing-data warnings; they do not prove the accuracy of every possible free-text answer.

## What I Learned

Registering tool schemas is only the first step. The program must reconstruct the assistant's selected calls, validate arguments, execute the registered functions, and append the actual results before asking the model for an answer. Separate workload and availability sources must not be inferred from one another. A shared snapshot keeps tool results consistent within a request, while unknown-data notes protect against omitted caveats.

## Next Week

During Week 14, refine the end-to-end agent workflow and error recovery, consider connecting tool-retrieved data to validated scheduling, and evaluate free-text answer precision on additional requests. Codex assisted with implementation, debugging, automated and live tests, setup configuration, and documentation.
