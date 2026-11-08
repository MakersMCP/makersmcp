---
name: troubleshooting
title: When a tool fails
index: setup, the errors the tools return and their fixes, the kits' flag names
description: Explains how a MakersMCP result shows a problem, from an argument the schema refused to a job that failed or a check that did not pass, lists the errors makersmcp itself returns with their fixes, says what check_setup reports and how to fix the setup, and maps the command line flags kit messages may name to the parameters they mean. Use it when a tool returns an error, a job fails, a tool is missing, or a message names a flag.
kit: makersmcp
requires: []
optional: [easybrandkit, easyfontkit, easyscreenshotkit, launch-film, musicfit, check_video, fit_music, analyze_music]
order: 90
---
# When a tool fails

Read the result before anything else: its first line says what happened, and the text under it says why, mostly with the fix. Never send a failed call again unchanged, since it fails the same way, unless the reason, or the tool's topic, says to wait or to try again.

## What the first line says

- "Input validation error: Invalid arguments for tool <tool>: <reason> at <param>": the arguments did not fit and nothing started. Fix that parameter: "an address starting with http:// or https://" wants the whole address, like https://linear.app, and "Too small: expected number to be >=30" wants a value inside the parameter's bounds. An argument the tool does not have is dropped without a word, so check the names.
- "Tool <tool> not found": that tool is not on this server. `check_setup` lists the kits that are on.
- "<title>: not started": makersmcp refused the call before a kit ran, so nothing changed. The reason follows.
- "<title>: failed after <time> (exit code <n>)": the kit ran and stopped, and what it said follows. Exit code 2 means it refused an argument before it changed anything.
- A first line that says "failed the check": a check ran and found faults. That is a normal result, with `passed` false: read its report and fix what it lists.
- "No job <job_id>": `wait_for_job` or `cancel_job` got an id it does not know. `list_jobs` shows the jobs there are.

## Not started

<!-- local -->
- "<param>: there is nothing at <path>": no file is there, and no job that is still running saves in its folder. A relative path is read from {base_dir}, so give the path the earlier result listed, or an absolute one. An address needs its https://.
- "<job_id> (<tool>) is still writing to <folder>", then "Wait for it with wait_for_job (job_id <job_id>), or give another out_dir.": wait for that job, or give this one another folder. A call that cannot save anywhere else, or that gives a file from that job's folder, even one not there now, which that job may write later or have cleared to write it again, ends "Wait for it with wait_for_job (job_id <job_id>), then call <tool> again." instead: wait for that job, then call it again. With ", which holds <path>" or ", inside <path>" after it, this job's folder, or a file or folder it was given, is inside that job's folder or holds it: run them one after the other.
<!-- with launch-film -->
  `render_launch_film`, `make_launch_stills` given a film.json, and a check of a film that job is writing, whatever its `out_dir`, get that second ending.
<!-- end -->
- "<setting>: <value> is no program file, so the kits that read <setting> cannot run it. Point it at the program, or take it out.": a setting this tool reads a program from names none, and the setup below has the fix.
- "Cannot make <folder>, the folder the kits save in: <reason>. Set --out or MAKERSMCP_OUT to a folder you can write to.": every kit runs in that folder, so `out_dir` does not help. The --out it names is makersmcp's own option, set in the client's settings like MAKERSMCP_OUT, and the setup below has the fix.
<!-- with launch-film -->
- "<param>: the kit cannot read a link. Give the text itself, or a file.", for `cuts` of `check_video`: give the seconds as text, like 3.2,7.5, or a file on this machine.
- "<param>: the kit takes <value> for a file, not for an address, and cannot download one." and "<param>: the kit takes <value> for an address, not for a file.", for `source` of `make_launch_stills`: it reads a value that ends in .json as a film.json on this machine, and any other value as a site's address.
- "out_dir: with these arguments <tool> saves in <folder> and cannot save anywhere else. Leave out_dir out."
- A call that would delete a file of the user's in a film's brand/ folder is refused and names the file: give another `out_dir`, or move the file. The launch-film topic has the cases.
<!-- end -->
<!-- end -->
<!-- hosted -->
- "<kit> is not running on makersmcp.com right now. Try again later." or "<tool> is not available on makersmcp.com right now. Try again later.": tell the user, and try again later. `check_setup` lists what runs now.
- "You have <n> jobs running or waiting. Wait for one of them to end.": wait for a running job with `wait_for_job` first. "You have used today's <n> jobs.": the result says when a job can start again; tell the user.
- "The kits are not available right now. Try again later.": tell the user.
- A refusal that names an argument, like "<param> is required.", says what to change in it.
- "makersmcp.com could not be reached, so it is not known whether <title> started. Check list_jobs before you start it again.", or one that starts "It is not known whether <title> started": the job may be running. Call `list_jobs`, wait for it there, and start it again only when it is not listed.
- "makersmcp.com could not be reached to wait for job <job_id>. The job keeps running there: call wait_for_job again in a minute.": do that. A `list_jobs` or `cancel_job` that could not reach it says to try again in a minute.
<!-- end -->

## Failed jobs

- Read the kit's own words after the first line: they name what was wrong and, mostly, the fix. The topic of the tool that failed lists its errors.
<!-- local -->
- The brand, font and screenshot kits clear what an earlier run left in their folder as they start, so a failed run of theirs into a folder that held a good result leaves it empty, while musicfit, a render and a check keep the earlier files until they succeed. Give the next run a folder of its own when a result there is still wanted.
<!-- end -->
<!-- hosted -->
- "It ran longer than <time> and was stopped.": a job here stops after {limit:job_minutes}, so ask for less, like fewer pages or a shorter film. "Something went wrong on our side. Try again in a while.": tell the user. A failed job keeps no files.
<!-- end -->
<!-- local -->
- A site that shows a bot check, a cookie wall or a login page instead of itself: a kit stops with "<address> answered with a bot check (<title>) instead of its page, so <what was not made>", or saves what the page showed. Tell the user what came back and ask for the logo, the colors or the screens. Never fill in a brand from a guess.
<!-- with easybrandkit -->
- "No logo was found on the page itself.", in a brand kit's notes: ask the user for the logo files.
<!-- end -->
<!-- end -->
<!-- hosted -->
- A site that shows a bot check, a cookie wall or a login page instead of itself: a kit stops with "<address> answered with a bot check (<title>) instead of its page, so <what was not made>", or saves what the page showed. Tell the user what came back. No tool here takes a logo, colors or screens the user gives in place of the site's own, so ask for another address: the product's own site when this one is not it, like its home page in place of its app's sign-in page. Otherwise ask whether to go on with what the kit saved. Never fill in a brand from a guess.
<!-- with easybrandkit, launch-film -->
  A brand is read from the home page at a site's root, so a deeper page, like /pricing or /en/about, gives the same brand kit, while a home page in a language, like /de, /en/ or /pt-br, is read as it is, and so is /home: when a site's root is a language or country chooser, ask for its home page in the user's language.
<!-- end -->
<!-- with easybrandkit -->
- "No logo was found on the page itself.", in a brand kit's notes: no tool here takes a logo the user gives, and a deeper page of the same site gives the same brand kit, so tell the user and ask for another address as above, or whether to go on without a logo.
<!-- end -->
<!-- with launch-film -->
- For an app, a plan whose `url` is its App Store or Google Play listing, with no `brand`, closes on the app's icon, so it needs no logo from the site. From an App Store listing, a plan is made from the listing alone when the site the listing names cannot be read, as behind a bot check.
<!-- end -->
<!-- end -->

<!-- local -->
## The setup

`check_setup` shows makersmcp's version and Node's, the folder files go to and whether it can be written, each kit with its version and state (on, "turned off by --kits", or not available and why), its tools and what it needs, and the Chrome and the ffmpeg found for the kits, with ffprobe while launch-film is on. Settings like CHROME_PATH, FFMPEG_PATH and MAKERSMCP_OUT go in this server's entry in the MCP client's settings, as its env, and take effect when the client starts makersmcp again. makersmcp gives the programs those lines name to every kit, except where a kit reads a program from a setting `check_setup` lists as no program file: a tool that would run that program then does not start (below). A setting names a program by its path, or by a command name that is on PATH, like ffmpeg. Ask the user to change a setting, and never guess a path.

- Chrome "not found in the usual places. Install Chrome, Chromium, Edge or Brave, or set CHROME_PATH.": the kits that open a site stop with "No Chrome, Chromium, Edge or Brave found. Install one, or point CHROME_PATH at its binary." Ask the user to install one, or to set CHROME_PATH to the browser's program.
<!-- with launch-film -->
  launch-film says "Chrome was not found. Install Google Chrome or Chromium, or set LAUNCH_FILM_CHROME to its path." CHROME_PATH reaches it too, unless LAUNCH_FILM_CHROME names another browser, which a line "launch-film's Chrome: <path>" then shows.
<!-- end -->
- "<name> did not start. Try again, or point CHROME_PATH at another browser.": the browser was found and did not start. Try once more, then ask the user to point CHROME_PATH at another browser's program.
- ffmpeg "not found on PATH. Install ffmpeg or set FFMPEG_PATH.": the kits that write video or sound stop, with "musicfit needs ffmpeg", "The demo needs ffmpeg, and none was found", a crash that names spawn ffmpeg ENOENT, or "<file> could not be read as a video" from a check. Ask the user to install ffmpeg, or to set FFMPEG_PATH.
- A line "<setting>: <value> is no program file, so the kits that read <setting> cannot run it. Point it at the program, or take it out.": that setting leads to a folder, like a whole Google Chrome.app, to no file, or to a command name that is not on PATH. makersmcp then starts no tool that reads a program from it, even while the line above names a program found elsewhere: the call ends "<title>: not started" with that same line, and nothing changed. A tool that reads no program from that setting still runs. Ask the user to point the setting at the program itself, or to take it out.
<!-- with launch-film -->
- ffprobe "not found beside ffmpeg or on PATH.": launch-film reads videos and pictures with it, and makersmcp gives it the ffprobe this line names. Without one, a check says "<file> could not be read as a video", and a render stops at its logo clip with "clip <n>: no logo could close the film: <reasons>", each reason saying "could not be read as a picture". The launch pictures of `make_launch_stills` stop with that same error when `for` holds ph, as it does by default, since those are drawn from the film's clips; for places without ph, like og, x, play or chrome, they end done with the note "No logo could be used (<reasons>), so the name stands in for it." and lack the logo and the screen. Ask the user for an ffmpeg that comes with ffprobe, or to set LAUNCH_FILM_FFPROBE to it, then render or make the pictures again. A line "launch-film's ffmpeg: <path>" means LAUNCH_FILM_FFMPEG names another ffmpeg than FFMPEG_PATH, and launch-film runs that one.
<!-- end -->
- "It cannot be written to, so no kit can save there." or "It does not exist, and it cannot be made in <folder>.", after the folder: every job fails, before it starts or with an error that names EACCES. Ask the user to set MAKERSMCP_OUT to a folder they can write to.
- A kit "turned off by --kits" has no tools here. The user turns it on in the --kits list, or MAKERSMCP_KITS, of this server's entry.
- When the client says makersmcp itself failed to start, its log has the reason, like "Unknown kit: <name>. The kits are <kits>, or all." for a wrong --kits list. makersmcp needs Node 22 or newer.
<!-- end -->
<!-- hosted -->
## The setup

Nothing needs installing: the kits run on makersmcp.com. `check_setup` lists the kits running there with their versions and tools, and how long files are kept. A kit "not running on makersmcp.com right now." has no tools until it is back, and a tool the servers cannot run for now is not listed: `check_setup` names it as "Held back: <tool> (<why>)". Tell the user it is not there for now.
<!-- end -->

## The kits' own words

Kit messages can name the kit's command line flags, like --timeout or --page. A result writes them as the parameters they stand for, but a file a kit wrote may still hold them. Each flag whose parameter has another name:

{flags}

## Each kit's errors

<!-- with easybrandkit -->
- `make_brand_kit`: the brand topic.
<!-- end -->
<!-- with easyfontkit -->
- `make_font_kit`: the fonts topic.
<!-- end -->
<!-- with easyscreenshotkit -->
- `take_screenshots` and `check_pwa_screenshots`: the screenshots topic. `record_demo_video`: the demo-video topic.
<!-- end -->
<!-- with launch-film -->
- `make_launch_film`, `plan_launch_film`, `render_launch_film`, `make_launch_stills` and `launch_film_guide`: the launch-film topic, and a film.json's problems the film-json topic.
<!-- end -->
<!-- with check_video -->
- `check_video`: the checks topic.
<!-- end -->
<!-- with fit_music -->
- `fit_music` and `analyze_music`: the music topic.
<!-- end -->
<!-- with analyze_music -->
<!-- without fit_music -->
- `analyze_music`: "Cannot read <file>: ffmpeg does not know this format", "<file> has no audio stream" or "<file> has no audio" means the file is no track ffmpeg reads, so ask the user for another file. A link that fails says why, as jobs-and-files lists. No tool here fits a track now, so the line of its FIT.md about fitting the track does not apply here.
<!-- end -->
<!-- end -->
