---
title: Hostile fixture
date: 2026-01-01
authors: [Nobody]
---

# Hostile fixture

<script>alert('inline block')</script>

<img src=x onerror="alert('inline img')">

<iframe src="https://evil.example"></iframe>

[js](javascript:alert('js'))
[data](data:text/html,<script>alert('data')</script>)
[ok](https://example.com)
[anchor](#section)

![jsimg](javascript:alert('jsimg'))
![dataimg](data:image/svg+xml,<svg onload=alert('dataimg')>)
![fig](figures/hostile/x.svg)

## Section

Some text.
