---
name: jobs-and-files
title: Jobs, waits and files
index: long jobs, calls that end early, cancelling, folders, passing one job's files to the next
description: Explains how a MakersMCP job runs and ends, how to wait for a long one, what to do after a call that ended with no result, what cancel_job and list_jobs do, where each job's files go and, locally, what a new run replaces, and how one job's files go into the next. Use it before running jobs side by side, after a call ended early, before reusing a folder, or when a file from one job has to go into another.
kit: makersmcp
requires: []
optional: [easybrandkit, easyfontkit, easyscreenshotkit, launch-film, musicfit, check_video, fit_music]
order: 80
---
# Jobs, waits and files

Every kit tool call starts one job, which runs the kit, saves files and ends done, failed or canceled. A check ends done too, with `passed` true or false. `wait_for_job`, `list_jobs` and `cancel_job` work on every job, whichever tool started it.

## Waiting for a job

- A kit tool waits `wait_seconds` for its job, {default:wait_for_job.wait_seconds} unless given, then returns. A job still running comes back with `status` running, its `job_id`, the kit's last line and a `next_action` naming `wait_for_job` with that `job_id`.
- Call `wait_for_job` with the `job_id` until the job ends. Never call the tool that started it again: that starts a second job.
- Some clients end a call after 60 seconds, and claude.ai and Claude Desktop after 240, whatever `wait_seconds` asks. {default:wait_for_job.wait_seconds} is safe in all of them.
<!-- hosted -->
- Here a call returns within {limit:max_wait}, whatever `wait_seconds` asks.
<!-- end -->
- `wait_seconds` 0 returns at once with the `job_id`: start several jobs that way, then wait for each in turn.
- While a tool waits, it sends the kit's progress lines to a client that asks for them, at most one a second.
- `wait_for_job` returns the job in any state. For a job that has ended it returns the whole result again, notes included, so it also reads an earlier result.

## A call that ended with no result

A client may end a call before the job ends, after a timeout or a lost connection, and then no `job_id` comes back. The job may still have started. Call `list_jobs`: a job of that tool started a moment ago is the one, and `wait_for_job` waits for it. Start the tool again only when `list_jobs` shows no such job.
<!-- hosted -->
A start makersmcp.com could not confirm says so: "makersmcp.com could not be reached, so it is not known whether <title> started. Check list_jobs before you start it again."
<!-- end -->

## Listing, cancelling, running side by side

- `list_jobs` gives one line a job, newest first: its id, tool, status, seconds and folder.
- `cancel_job` on a job that has ended returns it as it is.
<!-- local -->
- `list_jobs` shows the jobs this makersmcp started since it was launched: those still running, and the last 50 that ended. Jobs end when makersmcp ends, as when the client closes or restarts it. Their ids go with them, and `wait_for_job` then answers "No job <job_id>", but the files they saved stay in their folders.
- `cancel_job` stops a running job and the browser or ffmpeg it started. Files it saved stay. An earlier run's files that the kit cleared when it started are gone.
<!-- with easybrandkit -->
  A brand kit canceled part way can leave some of its files without its brand.json, and `make_brand_kit` then refuses that folder: give the next run another `out_dir`.
<!-- end -->
<!-- with easyscreenshotkit -->
  Screenshots canceled part way can leave some of the pictures without their manifest.json, and `take_screenshots` then refuses that folder: give the next run another `out_dir`.
<!-- end -->
- Jobs run side by side as far as the machine allows: four jobs that each opened Chrome have run at once. Two jobs never write into one folder, nor one into a folder inside the other's, since each would list the other's files as its own: the second is refused with "<job_id> (<tool>) is still writing to <folder>" and "Wait for it with wait_for_job (job_id <job_id>), or give another out_dir."
<!-- with launch-film -->
  A check of a film, which saves in check/ next to it, and pictures made from its film.json, which save in the film's folder, are such a pair: run them one after the other.
<!-- end -->
<!-- end -->
<!-- hosted -->
- `list_jobs` lists the user's 50 newest jobs. Jobs belong to the user and keep running when the connection closes. One waiting for a free worker shows running, with "Waiting for a free worker" as its last line.
- `cancel_job` stops a running job, and its files are deleted.
- At most {limit:jobs_at_once} can run or wait at once, and at most {limit:jobs_a_day} can start in a day. Past that a start is refused with "You have <n> jobs running or waiting. Wait for one of them to end." or "You have used today's <n> jobs.", and the time to try again.
- A job is stopped after {limit:job_minutes}, counted from when a worker takes it, the downloads of its links included: "It ran longer than <time> and was stopped." A job that failed, was canceled or was stopped keeps no files.
<!-- end -->

<!-- local -->
## Files on this machine

- The base folder is {base_dir}. Every relative path in a call, a file going in or an `out_dir`, is read from there, and a leading ~ is the home folder.
- Each kit tool that saves files uses one folder: `out_dir` when given, else a folder named after its input. In those names <host> is the address's host without www and without the port, so two sites on one host share a folder, and so do two apps of one store.
<!-- end -->
<!-- with easybrandkit -->
<!-- local -->
- `make_brand_kit` saves in easybrandkit-<host>. It takes a folder that is empty or holds an earlier brand kit, whose files it replaces. Any other folder stops it: "<folder> is not empty and holds no earlier brand kit. Pick another folder with out_dir."
<!-- end -->
<!-- end -->
<!-- with easyfontkit -->
<!-- local -->
- `make_font_kit` saves in easyfontkit-<host>, with the same rule for an earlier font kit.
<!-- end -->
<!-- end -->
<!-- with easyscreenshotkit -->
<!-- local -->
- `take_screenshots` saves in easyscreenshotkit-<host> and `record_demo_video` in easyscreenshotkit-demo-<host>, each with the same rule for an earlier run of that tool.
<!-- end -->
<!-- end -->
<!-- with launch-film -->
<!-- local -->
- `plan_launch_film`, `make_launch_film` and `make_launch_stills` given an address save in launch-film-<host>. `render_launch_film` saves next to its film.json, `make_launch_stills` given a film.json saves in stills/ next to it, and `check_video` saves in check/ next to the video.
- A new plan replaces film.json, words.json and brand/ in its folder, and leaves an earlier film.mp4, film.timeline.json, frames/ and stills/ there, which no longer match it. Given `brand`, these tools copy that kit into brand/, and a brand/ that holds a file of the user's stops the call before anything changes. Without `brand`, a plan that fails while reading the site may leave brand/ empty. The launch-film topic has the rest.
<!-- end -->
<!-- end -->
<!-- with musicfit -->
<!-- local -->
- `fit_music` and `analyze_music` share musicfit-<track's name>. Each deletes fitted.wav, mix.wav, cues.json, seams.png and FIT.md there before it writes and leaves other files alone, so `analyze_music` after `fit_music` on the same track deletes the fitted track.
<!-- end -->
<!-- end -->
<!-- local -->
- The brand, font and screenshot kits clear what an earlier run left in the folder as they start, so a run of theirs that fails or is canceled loses it too. musicfit, a render and a check replace their files only when they succeed. Before a run into a folder that holds a result the user wants, give another `out_dir`.
- A result lists the files the job saved or changed in its folder, without hidden files: 40 in the text and up to 200 in `files`. The kit's notes come after them. The list and the notes stay as they were when the job ended: what a later job saves in that folder, or in one inside it, never shows under this one, though it may have replaced some of these files since.
<!-- end -->

<!-- hosted -->
## Files on makersmcp.com

- Each job saves into a folder of its own, so no job replaces another's files.
- The result lists each file with its link, and until when, in UTC, the links work: {limit:keep_days}, for anyone who holds them, so give them only to the user. After that the job shows done with no files and "Its files were deleted after <n> days."
- A file an earlier job saved goes in as job:<job_id>/<path>, the path as that job's file list writes it. The job's whole folder comes along, so the files that file names are there too. Only the user's own jobs that ended done count, and a makersmcp.com link to such a file counts as its job:<job_id>/<path>.
<!-- with easybrandkit -->
  A brand kit goes in as job:<job_id>/brand.json, with its logo files.
<!-- end -->
<!-- with launch-film -->
  A plan goes in as job:<job_id>/film.json, with the brand and the screens it names.
<!-- end -->
<!-- with easyscreenshotkit -->
  Manifest screenshots go in as job:<job_id>/pwa/manifest-screenshots.json.
<!-- end -->
- Other files go as https links where a parameter takes a file: a public address, at most 200 MB, sent within 5 minutes. A parameter that takes an address or a file reads a link as the address.
- Nothing here uploads a file the assistant wrote, so a file goes in only as a link the user gives or as a file an earlier job saved, used as it is. Say so instead of offering to change one.
- "Job <job_id> has no file <path>." means the path is not as that job's file list writes it. "There is no job <job_id> with files to use. list_jobs shows your jobs; files are kept for a few days." means the job is not the user's, did not end done, or its files are gone.
- A link that fails says why: "The link's host <host> was not found.", "The link's host <host> is not on the public internet.", "The link answered <status> instead of the file.", "The file is over <size>.", "The link took too long to answer.", "The link took more than <time> to send the file.", "The link stopped sending the file.", "The link redirects too many times.", "A link with a user name or password in it is not allowed." or "Only http and https links work." Ask the user for a public link to the file itself.
<!-- end -->

## Passing files from job to job

<!-- with easybrandkit -->
<!-- with launch-film -->
- The brand kit of `make_brand_kit` goes to `brand` of `plan_launch_film` and `make_launch_film`.
<!-- end -->
<!-- end -->
<!-- with launch-film -->
- film.json of `plan_launch_film` or `make_launch_film` goes to `film` of `render_launch_film` and `source` of `make_launch_stills`, and words.json to `words` of the next plan, which then does not read the page again.
<!-- end -->
<!-- with check_video -->
- film.mp4 goes to `film` of `check_video`, which finds film.timeline.json beside it, under that name only.
<!-- end -->
<!-- with easyscreenshotkit -->
- pwa/manifest-screenshots.json of `take_screenshots` with `pwa` goes to `manifest` of `check_pwa_screenshots`, and demo.yaml of a `record_demo_video` tour to its `steps`, to record that tour again.
<!-- end -->
<!-- with fit_music -->
- `length` and `hit` of `fit_music` come from the video.
<!-- with launch-film -->
  A launch film's length and its logo close's start are in its film.timeline.json.
<!-- end -->
<!-- with check_video -->
  The Cuts table of the `CHECK.md` that `check_video` returns has them too.
<!-- end -->
<!-- with easyscreenshotkit -->
  A demo's are video.duration and a click's pressedAt in its steps.json.
<!-- end -->
<!-- with check_video -->
- cues.json of `fit_music` or `analyze_music` goes to `cues` of `check_video`.
<!-- end -->
<!-- end -->

<!-- with launch-film -->
<!-- local -->
Give a file by its path, as the earlier result lists it:

```call
plan_launch_film {"url": "https://linear.app", "brand": "launch/brand", "out_dir": "launch/film-16x9"}
render_launch_film {"film": "launch/film-16x9/film.json"}
```
<!-- end -->
<!-- hosted -->
Give a file as job:<job_id>/<path>, with the id of the job that saved it:

```call
plan_launch_film {"url": "https://linear.app", "brand": "job:<job_id>/brand.json"}
render_launch_film {"film": "job:<job_id>/film.json"}
```
<!-- end -->
<!-- end -->
