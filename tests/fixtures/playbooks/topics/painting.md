---
name: painting
title: Pictures painted from a site
index: paint_picture and check_picture: a picture of a site, its size, its check
description: Paints a picture of a website with paintkit and checks its size. Use it when the user wants a picture of a site, a cover or art for a post.
kit: paintkit
requires: [paintkit]
optional: [soundkit]
order: 20
---
# Pictures painted from a site

`paint_picture` paints a {fact:paintkit.size} picture of a website, and `check_picture` checks it. It runs {place}.

## Steps

1. Paint the picture. `url` is the site; `hue` is {bounds:paint_picture.hue} ({default:paint_picture.hue} by default); `width` goes from {bounds:paint_picture.width} pixels; `layers`, `length`, `marks`, `clean`, `sketch` and `timeout_seconds` change the strokes.
<!-- local -->
```call
paint_picture {"url": "https://example.com", "hue": "cool", "layers": 2, "length": 3.5, "marks": "1.5,3", "width": {fact:paintkit.width}, "clean": false, "keep": true, "out_dir": "pictures/example"}
```
`keep` keeps the work files. `out_dir` is the folder, relative to {base_dir}, and its default is `paintkit-<host>`.
<!-- end -->
<!-- hosted -->
```call
paint_picture {"url": "https://example.com", "hue": "cool", "layers": 2, "length": "3.5", "marks": "1.5,3", "sketch": "https://example.com/sketch.png", "timeout_seconds": 300}
```
A job stops after {limit:job_minutes} here, and `picture.png` comes back as a link.
<!-- end -->
2. Check it with `check_picture`: `picture` is the file and `expect` its size.
<!-- local -->
```call
check_picture {"picture": "pictures/example/picture.png", "expect": "{fact:paintkit.size}", "out_dir": "pictures/example/check"}
```
<!-- end -->
<!-- hosted -->
```call
check_picture {"picture": "job:<job_id>/picture.png", "expect": "1200x630"}
```
<!-- end -->
<!-- with soundkit -->
3. For a sound under it, see the sound topic: `mix_sound` mixes one at {fact:soundkit.rate} Hz.
<!-- end -->
<!-- without soundkit -->
3. No sound kit is on here, so the picture stays silent.
<!-- end -->
4. Read `PAINT.md`, then show `picture.png` and the `layers/<n>.png` files. A failed check is a normal result: `passed` is false and `CHECK.md` says why.

## When something goes wrong

- "<url> answered <status>, so no picture was painted.": check the address, or give more `timeout_seconds`.
- "<file> could not be read as a picture": give a PNG.

## Hand over

Give the user `picture.png` and what `CHECK.md` found. The picture is at most {fact:paintkit.hues.cool} hues of cool.
