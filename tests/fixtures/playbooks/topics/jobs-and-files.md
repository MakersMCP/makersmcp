---
name: jobs-and-files
title: Jobs and files
index: long jobs, waits, cancelling, folders
description: How the fixture jobs run, wait and end, and where their files go.
kit: makersmcp
requires: []
order: 80
---
# Jobs and files

A tool waits `wait_seconds`, {default:wait_for_job.wait_seconds} by default and {bounds:wait_for_job.wait_seconds} seconds, then returns a `job_id`.

1. Call `wait_for_job` with the `job_id` until the `status` is done.
2. Call `list_jobs` after a call that ended with no result.
3. Call `cancel_job` to stop one.

```call
wait_for_job {"job_id": "job_1a2b3c4d", "wait_seconds": 45}
```

<!-- local -->
Files go in folders under {base_dir}.
<!-- end -->
<!-- hosted -->
At most {limit:jobs_at_once} run at once and {limit:jobs_a_day} a day, each for {limit:job_minutes} at most. A call waits {limit:max_wait} seconds at most.
<!-- end -->
