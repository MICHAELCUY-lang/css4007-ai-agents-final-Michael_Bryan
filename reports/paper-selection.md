# Research Paper Selection

Supplementary reading for the Level C Study Planner Agent. The course requires this form for Level A in Week 14.

## Title

ToolFailBench: Diagnosing Tool-Use Failures in LLM Agents

## Authors

Harsh Soni

## Original Public Release Date

6 July 2026 (arXiv v1)

## Paper Link

[ToolFailBench preprint](https://arxiv.org/abs/2607.04686)

## Relevance and Technical Contribution

ToolFailBench evaluates tool use on 1,000 tasks. It pairs tasks that require external evidence with control tasks that can be answered directly even when tools are available. It checks the trace for four failures: skipping a required tool, disregarding a returned value, inventing a tool result, and making an unnecessary call. Its evaluation combines a rule-based classifier with two model judges.

For Study Planner Agent, this suggests checking tool selection and the final answer separately. A question about actual deadlines should call `list_assignments` and report dates from the returned records. A question about general study techniques should make no tool calls. A request for a feasible study schedule should use the available minutes returned by `get_study_capacity`. The benchmark motivates these checks, and the planner will measure its own performance using its own fixtures. [Paper methodology](https://arxiv.org/html/2607.04686v1)

## Figure, Algorithm, or Experiment to Explain

Figure 2 in Section 5.2 compares how often models handle tool-required tasks cleanly with how often they call a tool on a control task. Most evaluated models rarely make unnecessary calls. The Llama 3.1 models are outliers that call tools on many control tasks. To explain the figure, contrast two planner cases: looking up an actual due date and asking for advice on breaking a long reading session into blocks. The trace shows whether the model correctly distinguished the cases. [Figure 2 and analysis](https://arxiv.org/html/2607.04686v1#S5.SS2)
