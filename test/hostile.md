+++
title = "Hostile input fixture"   # trailing comments are ignored
author = 'Baram Soft'
count = 42
ratio = 1.5
draft = false
published = 2026-10-01
tags = [
  "security",      # multi-line arrays are common in Hugo front matter
  "sanitising",
]
colour = "#f6f8fa"   # a hash inside a string is not a comment
escaped = "a \"quoted\" word\tand a tab"

[meta]
reviewer = "Baram Soft"
nested = { depth = 2 }
+++

# Hostile input fixture

Every block below is something a malicious `.md` file could contain. None of it
may execute, and none of it may survive into the rendered DOM.

## Script injection

<script>window.alert('inline-script')</script>

<SCRIPT>window.alert('uppercase-script')</SCRIPT>

<scr<script>ipt>window.alert('nested-script')</scr</script>ipt>

## Event handlers

<img src="x" onerror="window.alert('img-onerror')">

<img src=x onerror=&#97;lert('entity-onerror')>

<div onmouseover="window.alert('onmouseover')">hover me</div>

<details open ontoggle="window.alert('ontoggle')"><summary>s</summary>d</details>

<body onload="window.alert('onload')">

## Dangerous URL schemes

[javascript link](javascript:window.alert\('md-js-link'\))

<a href="javascript:window.alert('html-js-link')">html javascript link</a>

<a href="JaVaScRiPt:window.alert('mixed-case')">mixed case scheme</a>

<a href="vbscript:MsgBox(1)">vbscript link</a>

<a href="data:text/html,<script>window.alert('data-uri')</script>">data uri link</a>

## Framing and form hijacking

<iframe src="https://example.com/"></iframe>

<object data="https://example.com/"></object>

<embed src="https://example.com/">

<base href="https://example.com/">

<form action="https://example.com/steal"><input name="x"><button formaction="https://example.com/x">go</button></form>

## SVG and MathML vectors

<svg><script>window.alert('svg-script')</script></svg>

<svg><a xlink:href="javascript:window.alert('svg-xlink')"><text y="20">svg link</text></a></svg>

<math><mtext><option><FAKE><img src=x onerror="window.alert('mathml')"></option></mtext></math>

## Style injection

<style>body { display: none !important; }</style>

<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:red">overlay</div>

## Benign content that must survive

A [real link](https://baramsoft.com) and `inline code` and **bold text**.

```js
const safe = "this should still highlight";
```

| column | value |
| ------ | ----- |
| works  | yes   |
