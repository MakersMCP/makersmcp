---
name: sound
title: A sound for a picture
index: mix_sound: a sound mixed for a picture
description: Mixes a sound for a picture with soundkit. Use it when the user wants music or a sound under a picture.
kit: soundkit
requires: [soundkit]
optional: [paintkit]
order: 30
---
# A sound for a picture

`mix_sound` mixes a sound at {fact:soundkit.rate} Hz from `track`, with `meter` beats to a bar.

<!-- local -->
```call
mix_sound {"track": "music/track.wav", "meter": 4, "out_dir": "music/mixed"}
```
<!-- end -->
<!-- hosted -->
```call
mix_sound {"track": "https://example.com/track.wav", "meter": "4"}
```
<!-- end -->
<!-- with paintkit -->
For a picture from `paint_picture`, mix a sound as long as you like.
<!-- end -->

## When something goes wrong

- "The sound is silent": give another `track`.

## Files

It writes `mix.wav` and `MIX.md`.
