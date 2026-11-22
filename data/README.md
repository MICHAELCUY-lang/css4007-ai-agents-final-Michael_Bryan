# Study data examples

Both JSON files contain synthetic demonstration records, not a history of real assignments or completed work.

- `week-12.json`: 210 minutes of assignments and 210 known available minutes. All work can fit on or before its deadline.
- `over-capacity.json`: 150 minutes of assignments, 30 available minutes on November 22, zero on November 23, and unknown availability on November 24. At least 120 minutes must remain unscheduled.

Input fields:

| Field | Meaning |
| --- | --- |
| `start_date`, `end_date` | Inclusive planning range in `YYYY-MM-DD` format, at most 31 days |
| `assignments[].id` | Unique assignment identifier |
| `assignments[].title`, `course` | Nonempty task and course names |
| `assignments[].deadline` | Last local calendar day on which the assignment may be scheduled |
| `assignments[].estimated_minutes` | Positive integer amount of remaining work |
| `availability[].date` | Unique day within the planning range |
| `availability[].minutes` | Integer daily time budget from 0 to 1,440 minutes |

Dates are calendar dates, with no conversion between time zones. Data from historical dates can be replayed for evaluation. Assignment deadlines can fall outside the planning range; already overdue work is left unscheduled. Missing days remain unknown. The application never treats a missing record as free time.
