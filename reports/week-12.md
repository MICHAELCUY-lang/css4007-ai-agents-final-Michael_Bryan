# Semester Week 12 Progress Report

## Completed Work

Implemented and verified the core scheduling workflow on November 22, 2026, within the November 16-22 Week 12 window. Added structured model priorities, a session allocator, input/output validation, deadline checks, daily budgets, and remaining-work totals. Added synthetic examples, CLI modes, architecture notes, and local Ollama setup. The live checks used Qwen3 0.6B; the default 4B download stalled and that model was not tested.

## Important Commits

- [`45d4d8ec2dc9dbde49074befbc9c30871b8bd41f`](https://github.com/MICHAELCUY-lang/css4007-ai-agents-final-Michael_Bryan/commit/45d4d8ec2dc9dbde49074befbc9c30871b8bd41f): Implement validated study schedules and Week 12 core examples. This commit also includes 16 scheduling/CLI tests, two additional transport failure tests, and the automated test results.
- [`d3303e39adf39750cb356a4f4f84fc2373588a75`](https://github.com/MICHAELCUY-lang/css4007-ai-agents-final-Michael_Bryan/commit/d3303e39adf39750cb356a4f4f84fc2373588a75): Allocate sessions from validated model priorities after live failures, add four allocator tests, and record the initial and final live results.

## Current Functionality

The CLI supports free-text study questions, `--check` without a model, and `--plan` with readable or JSON output. The model returns every known assignment ID once in priority order. The allocator honors earlier deadlines, uses model priority for ties, and splits work into sessions of at most 60 minutes. Each session is validated against known assignments, dates, budgets, and workload estimates. The program reports remaining work and unknown days. Model-selected data tools remain Week 13 work; the complete Level C tool-calling workflow is not yet implemented.

## Problems Encountered

Week 11 had no live model verification. Network interruptions made the 4B download impractical for this run. Initial live tests with the smaller model scheduled only 129 of 210 possible minutes and proposed a session after its deadline. See the [initial results](evidence/week-12-live-initial.json). Missing availability also needs to remain distinct from a known zero-minute day.

## Solutions

Moved calendar and minute allocation into application code while retaining AI priority for tied deadlines. Validate that the model returns every supplied ID exactly once; reject invented, duplicated, or omitted IDs. Missing days are not scheduled. Totals are calculated from the accepted sessions. The official model blob's SHA256 was checked before local use.

`node --test` passed all 40 tests: 30 application tests and 10 inherited starter tests. See [test output](evidence/week-12-tests.txt). Both example files passed `--check` and the real CLI generated the expected schedules.

The [final live run](evidence/week-12-live.json) used Ollama 0.40.17 and `qwen3:0.6b`. The normal example scheduled 210/210 minutes. The constrained example scheduled 30 minutes, reported 120 remaining minutes, and preserved November 24 as unknown. The general-question case checks a nonempty response only: the small model's free-text advice was incomplete, and its semantic quality still needs evaluation. It is not covered by the schedule validator.

## What I Learned

JSON schema constrains model output shape; it does not ensure correct scheduling arithmetic. Separating priority selection from allocation makes daily budgets and deadlines enforceable in code. Deadline checks use inclusive calendar dates. Cumulative checks and totals outside the model keep the schedule and remaining workload consistent. The current allocator uses daily budgets and does not model time-of-day preferences or breaks.

## Next Week

During Week 13 (November 23-29), implement and register `list_assignments` and `get_study_capacity`, let the model select tools, validate arguments, return local-data results to the model, and record execution logs. Reuse the allocator and validator with tool results. Evaluate the larger model and free-text advice quality during reliability/evaluation work. Codex assisted with implementation, setup, tests, failure analysis, and documentation.
