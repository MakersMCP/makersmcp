---
name: getting-started
title: Getting started with the fixture kits
index: which tool fits which request, how jobs work
description: Says which fixture tool fits which request and how a job runs. Use it when unsure which tool to call.
kit: makersmcp
requires: []
optional: [paintkit, soundkit]
order: 10
---
# Getting started with the fixture kits

The kits make files {place}. Each line is a tool, its topic and what the user asks for:

{requests}

## How a job runs

One call is one job. A job still running after `wait_seconds` returns a `job_id`: call `wait_for_job` with it.
<!-- with soundkit -->
Sounds come from `mix_sound`.
<!-- end -->
<!-- without soundkit -->
There is no sound kit here: tell the user no sound can be made.
<!-- end -->
