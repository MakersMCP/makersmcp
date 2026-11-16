---
name: music
title: Music fitted to a film or a demo
index: analyze_music and fit_music: a track fitted to a film or a demo and laid under it, the hit, a voice
description: Fits a music track to a video's exact length with musicfit, lands its drop on a chosen moment, ducks it under a voice, sets its loudness and lays it under the video, keeping, voicing or dropping the video's own sound. Use it when a track from the user, a library or a music model has to fit a launch film, a demo or any cut.
kit: musicfit
requires: [musicfit, fit_music]
optional: [easyscreenshotkit, reframekit, check_video, make_launch_film, plan_launch_film]
order: 70
---
# Music fitted to a film or a demo

`fit_music` makes a music track exactly as long as a video by cutting or looping whole bars, lands its drop on a chosen moment (the hit), ends it on a beat, ducks it under a voice and sets its loudness. Given the video, it also writes video.mp4: the video's picture as it was, with the track under it. `analyze_music` reads the track's tempo, bars, drop and ending first.

## Decide first

- The video's exact length, its frame rate and the moment for the drop: the next section says where each comes from.
- The track: any file ffmpeg reads, a video's sound too. No tool here makes music, so when the user has none, say so and ask for one. An instrumental a little longer than the video fits best: seams follow bars and can cut a sung line, and the tempo and pitch never change.
- The video's own sound, when the track goes under it as `video`: `video_sound` keep for sound effects, voice for speech, drop for music of its own. A video with more than a faint room tone is refused until it is given, so ask the user what that sound is when it is not known.
- Never call a track cleared for use: musicfit does not check rights.
<!-- with make_launch_film, plan_launch_film -->
- A launch film that is to carry the user's track is planned with `music` false, after reading the track's tempo (A launch film's tempo, below), so its own sound is its effects: lay the track under its film.mp4 with `video_sound` keep.
<!-- local -->
  Or name the fitted track in the music field of its film.json, by a path from film.json's folder like "music/fitted.wav", and render the film again with `render_launch_film`, which mixes it with the film's effects.
<!-- end -->
<!-- end -->

## Where the numbers come from

<!-- with make_launch_film, plan_launch_film -->
- A launch film runs at {fact:launch-film.fps} frames a second. `film.timeline.json` beside its `film.mp4` gives its length as `seconds`, and its logo close, the usual hit, as the `start` of the clip whose `kind` is logo.
<!-- with check_video -->
  Without access to that file, `check_video` without `cues` gives the same in `CHECK.md`: the length and frame rate of any video, and a launch film's cuts with their times and kinds.
<!-- end -->
<!-- end -->
<!-- with easyscreenshotkit -->
- A demo from `record_demo_video` runs at its `fps`, {default:record_demo_video.fps} unless set. Its `steps.json` gives the length as `video.duration`, or as `video.frames` with an f, and each click's moment as `pressedAt`.
<!-- end -->
- Any other video: ask the user for its length and frame rate, or give it as `video`, whose frame rate counts the frames unless `fps` is given.

## Steps

1. Read the track with `analyze_music`. `FIT.md` comes back with its tempo, its drop and the other candidates, its ending and any warning.
<!-- local -->
```call
analyze_music {"track": "music/track.mp3"}
```
<!-- end -->
<!-- hosted -->
```call
analyze_music {"track": "https://example.com/track.mp3"}
```
<!-- end -->
2. Fit it with `fit_music`: `length` and `hit` as text, like "29.333" or "600f", `fps` the video's, and the video as `video` with its `video_sound`. Give `drop` only when the drop `FIT.md` names is not the one the user means.
<!-- with make_launch_film, plan_launch_film -->
   For a launch film, `length` is its `seconds`, `hit` its logo `start` and `fps` {fact:launch-film.fps}.
<!-- local -->
   Give `out_dir` a folder inside the film's, like its music/, so the film's folder holds its track.
```call
fit_music {"track": "music/track.mp3", "length": "29.333", "hit": "24", "fps": {fact:launch-film.fps}, "video": "launch/film-16x9/film.mp4", "video_sound": "keep", "out_dir": "launch/film-16x9/music"}
```
<!-- end -->
<!-- hosted -->
```call
fit_music {"track": "https://example.com/track.mp3", "length": "29.333", "hit": "24", "fps": {fact:launch-film.fps}, "video": "job:<job_id>/film.mp4", "video_sound": "keep"}
```
<!-- end -->
<!-- end -->
<!-- without make_launch_film, plan_launch_film -->
<!-- local -->
```call
fit_music {"track": "music/track.mp3", "length": "32", "hit": "27.5", "fps": 30, "video": "demo/demo.mp4", "out_dir": "music/fit"}
```
<!-- end -->
<!-- hosted -->
```call
fit_music {"track": "https://example.com/track.mp3", "length": "32", "hit": "27.5", "fps": 30, "video": "https://example.com/cut.mp4", "video_sound": "drop"}
```
<!-- end -->
<!-- end -->
3. Read `FIT.md`: its "Where to listen" table gives the start, each seam, the hit and the end. Show `seams.png`, and act on any warning.
4. With `video`, video.mp4 is the video with the track under it, the file to hand over once the user has heard it. Without it, the next section says how the track goes under the video.
<!-- with check_video -->
5. Check it with `check_video`, then hand it over.
<!-- end -->
<!-- without check_video -->
5. Hand it over.
<!-- end -->

## Laying it under the video

`video` lays it: video.mp4 keeps the video's picture as it was, copied, with the track under it at `lufs`, and the video's own sound kept as effects, set as speech or left out, as `video_sound` says. The video has to be `length` long, to a frame. With a `voice`, the music dips under it there too.
<!-- local -->
Without `video`, one ffmpeg command does it when you can run commands, with the paths the results gave:

```sh
ffmpeg -i <video> -i <fit folder>/fitted.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k <video's folder>/with-music.mp4
```

The track then replaces the video's sound. With a `voice`, give `mix.wav` instead.
<!-- end -->
<!-- hosted -->
Without `video`, nothing here lays the track: hand over the links to the video and the track.
<!-- end -->
A track handed over alone goes under the whole video from its first frame, in the app the user cuts video with, without trimming or stretching it: it is already exactly as long.

<!-- with check_video -->
## Checking it

`check_video` with `cues` set to the fit's `cues.json` measures whether each cut lands on a beat. Its `expect` is {fact:launch-film.size_16_9}@{fact:launch-film.fps} for a launch film, {fact:launch-film.size_9_16}@{fact:launch-film.fps} for 9:16. video.mp4 has no timeline under its name, so give `cuts` the film's `film.timeline.json`.
<!-- local -->
```call
check_video {"film": "launch/film-16x9/music/video.mp4", "expect": "{fact:launch-film.size_16_9}@{fact:launch-film.fps}", "cues": "launch/film-16x9/music/cues.json", "cuts": "launch/film-16x9/film.timeline.json"}
```
<!-- end -->
<!-- hosted -->
```call
check_video {"film": "job:<fit_job_id>/video.mp4", "expect": "{fact:launch-film.size_16_9}@{fact:launch-film.fps}", "cues": "job:<fit_job_id>/cues.json", "cuts": "job:<film_job_id>/film.timeline.json"}
```
<!-- end -->
<!-- with make_launch_film, plan_launch_film -->
- A film planned by `plan_launch_film` with `music` false fails the silence check until a track is under it; with `sfx` false too it is silent throughout, which passes with the warning "the sound is silent throughout" unless `lufs` is given.
<!-- end -->
- A track with no steady beat has empty `beats`, which `check_video` refuses.
<!-- with easyscreenshotkit -->
- For a demo, give `cuts` the clicks' `pressedAt` in seconds, like "2.25,4.632,7.017": `steps.json` is no cuts file.
<!-- end -->
<!-- end -->

<!-- with make_launch_film, plan_launch_film -->
## A launch film's tempo

A launch film's clips last whole bars of its look's own music, so its cuts follow the look's tempo: launch {fact:launch-film.look_bpm.launch}, aurora {fact:launch-film.look_bpm.aurora}, gridline {fact:launch-film.look_bpm.gridline}, pop {fact:launch-film.look_bpm.pop} and journal {fact:launch-film.look_bpm.journal} BPM. Nothing here changes it. With the drop on the logo close, a track at that tempo, or half or double it, lands every cut on a beat; at any other tempo, a near one too, some cuts fall between beats. So before a plan, read the track and tell the user which look matches its tempo, if one does, since the look also sets the film's style (`launch_film_guide` with topic looks). Give `plan_launch_film` that `look` once they agree.
<!-- with check_video -->
For a film already made, say which cuts `check_video` found off the beat.
<!-- end -->
<!-- end -->

## Every parameter

`fit_music` also takes:
- `voice`, a recording on the video's timeline from its first frame, which the user brings. The music dips by `duck` dB (default {default:fit_music.duck}) wherever it speaks; `mix.wav` is the voice over the ducked music at `lufs`, and `fitted.wav` the ducked music alone. With `video_sound` keep, `duck` is also the most the music dips under one of the video's own sounds.
- `lufs` (default {default:fit_music.lufs}), set with one gain. A limiter keeps the true peak at {fact:musicfit.true_peak} dBTP or under, so a peaky track can come out quieter, as `FIT.md` says.
- `end`: auto ends on the track's own last hit when it has one and there is room after the hit, else with a fade; natural or fade asks for one. `fade` is in seconds, rounded to whole beats, a bar by default.
- `bpm` and `meter` ("3" or "4"), to correct a tempo or a bar that `FIT.md` warns about.
- `length` from {fact:musicfit.length_min} to {fact:musicfit.length_max} seconds, and `hit` at least {fact:musicfit.hit_tail} s before its end, one a run. Without `hit` the track starts as it starts.
<!-- local -->
- `out_dir`: by default musicfit-<track's name> in {base_dir} for `fit_music`, and musicfit-<track's name>.analysis for `analyze_music`, so an analysis never replaces a fit.
<!-- end -->
- `wait_seconds`: both tools finish in seconds, and a long `video` takes a minute or more.
<!-- hosted -->
- A job here reads a track, a voice and a video's own sound of a set length at most, together, as both tools hold each whole in memory a few times over: past that the job fails before the kit starts, naming each length and the most taken.
<!-- end -->

`analyze_music` takes `track`, `bpm` and `meter` the same way. It has no `fps`: its frames count at {fact:musicfit.analyze_fps} a second, so use its times in seconds.

## What it writes

<!-- local -->
A run puts its files in place once it has ended well, replacing those an earlier run wrote there; one that fails, is refused or is canceled leaves the folder as it was. A file there of the user's under a name it writes stops it.
<!-- end -->
<!-- hosted -->
Each job has a folder of its own and lists links to its files. Pass a file on as job:<job_id>/<path>, like job:<job_id>/cues.json.
<!-- end -->
`fit_music` writes `fitted.wav`, the track at `length`, {fact:musicfit.sample_rate} Hz {fact:musicfit.channels}, at `lufs`; `mix.wav` with a `voice`; `video.mp4` with a `video`; `seams.png`, the track, the result and each seam; `FIT.md`, which comes back in the result; and `cues.json`, with `beats`, `bars` and `hits` (the drop and the track's last hit) as frames at `fps` and in seconds under `times`. That of `analyze_music` lists the drop candidates under `source.dropCandidates`.

## When something goes wrong

A failed `fit_music` or `analyze_music` job gives its reason:
- "hit has to fall inside length" or "hit has to leave at least half a second after it": an earlier `hit`.
- "<length, hit or drop> takes a time such as 32, 32.5s, 960f or 1:05": one of those forms.
- "No drop found to land on hit": give `drop`, or leave `hit` out.
- "No way to fit this track to that length": try without `hit`, or with another `end`.
- "The track is silent", "The track has no whole bar of music" or "<file> has no audio stream": ask the user for another file.
- "<video> has sound of its own for <time> of its <length> s, so say what becomes of it with video_sound": ask the user whether it is effects, speech or music, and give `video_sound`.
- "<video> is <seconds> s long and length is <length> s": give `length` the video's own length, as the reason says.
<!-- local -->
- "<param>: there is nothing at <path>": a relative path is read from {base_dir}.
- "musicfit needs ffmpeg": the troubleshooting topic.
<!-- end -->

Warnings come with a done job, in `FIT.md` too:
- "The tempo could also be <N> BPM": when the seams sound like they skip, fit again with `bpm` set to it.
- "The bars may have three beats" or "The bars have three beats": when the cuts sound off, fit again with `meter`.
- "No steady beat found" or "The beat is weak": the parts join with one-second crossfades, so listen to every seam.
- "Only <N> s of the track comes before its drop": an earlier `hit`, or a later `drop`.
- "The voice runs <N> s past the end" or "No speech was found in the voice track": check the voice with the user.
- `FIT.md` says "no clear drop was found", or names the wrong drop: give `drop` a candidate `analyze_music` listed.

## Hand over

<!-- local -->
- video.mp4, the video with the track under it, or the video and the track to lay in, with their paths.
<!-- end -->
<!-- hosted -->
- The link to video.mp4, the video with the track under it, or the links to the video and to the track to lay in.
<!-- end -->
<!-- with reframekit -->
- Each place's version made with `reframe_video` from video.mp4, which carries the track, never from the video it went under. No timeline or steps file is beside video.mp4 under its name, so give `reframe_video` the launch film's film.timeline.json as `cuts`, or the demo's steps.json as `steps` (the reframe topic).
<!-- end -->
- From `FIT.md`: the length and level, the tempo, where the drop landed, and the moments to listen at.
<!-- with check_video -->
- What `check_video` measured: cuts on the beat, loudness, true peak.
<!-- end -->
- That nothing here checked whether the track may be used.
<!-- hosted -->
- That the links work for {limit:keep_days}, for anyone who has them.
<!-- end -->
