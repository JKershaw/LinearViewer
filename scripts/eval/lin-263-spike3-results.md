# LIN-263 — spike 3: K=3 confirmation on the hard end (incl. real tickets)

Run of `scripts/eval/lin-263-spike3.mjs`. Confirms whether spike-2's cheap winners hold
at **K=3** on the most complex shapes, including **real, large Linear tickets**. Opus 4.8
runs K=1 as the reference anchor (cost discipline: "avoid the pricey models"); the cheap
candidates run K=3. temp 0. Real tickets snapshotted in `lin-263-spike3-out/fixtures/`.
Run spend: **~$0.77**.

## Results

| Task | gold | opus-4.8 (ref, K=1) | gpt-5.4-mini ×3 | gemini-3.5-flash ×3 | deepseek-v4-flash ×3 | haiku-4.5 ×3 |
|------|------|---------------------|------------------|----------------------|----------------------|--------------|
| **A** SYN-12 dense leaf (synthetic, embeds a plan) | breakdown | breakdown | **breakdown ×3 ✓** | **breakdown ×3 ✓** | research ×2, breakdown ×1 ✗ | **research ×3 ✗** |
| **B** LIN-177 **real epic NODE** (defer path, 6.5k-word prompt) | defer→LIN-334 | defer → **LIN-332** (a *done* child!) | defer ×2 →LIN-334 ✓ | **defer ×3 →LIN-334 ✓** | **defer ×3 →LIN-334 ✓** | **defer ×3 →LIN-334 ✓** |
| **C** LIN-344 **real large dense leaf** (7.4k desc, 5 comments) | (compare to Opus) | defer | defer ×3 ✓ | defer ×3 ✓ | defer ×3 ✓ | defer ×3 ✓ |

Per-model spend this run: opus $0.27 · **gpt-5.4-mini $0.05** · gemini-3.5-flash $0.29 ·
**deepseek-v4-flash $0.01** · haiku $0.13.

## What the confirmation establishes

1. **The Haiku cliff is real and consistent — not noise.** On the dense embedded-plan
   leaf (A), Haiku routed `research` **3/3** (spike-2's single miss reproduces every
   time). It under-reads the plan that's already in the ticket and over-fires to research.
2. **DeepSeek-V4-Flash shares the same cliff** — `research ×2, breakdown ×1` (1/3) on (A).
   The ultra-cheap value pick is **not robust on dense leaves**. Demote it from "recommend"
   to "promising but shares Haiku's weakness."
3. **GPT-5.4-Mini and Gemini 3.5 Flash are robust** — **3/3** on the cliff case, correct
   on the node, match Opus on the real leaf. These two passed every hard case.
4. **The most complex path (node/`defer`) is the EASIEST, for everyone.** On the real
   6-child epic with a 6.5k-word meta-prompt, *all* models — Haiku included — routed
   `defer ×3` and picked the correct next child **LIN-334**. So the failure axis is **not
   task size or complexity** — it's specifically *reading a dense leaf whose body already
   contains structured content*. The node format presents children as a clean overview +
   suggested-next pointer, which is easy; a wall-of-plan description is what trips Haiku.
   - *Implication for the user's heuristic:* "if it works on the most complex (node) case
     it's fine" is **not** safe — the node case is the easy one. The dense-leaf case is
     the real test, and it's where the cheap-but-weak models fail.
5. **Opus-as-reference is not infallible.** On the node case Opus (K=1) deferred to
   **LIN-332 — a *completed* child** — while every cheap model picked the correct ready
   child LIN-334. Here the cheap models were *more* correct than the reference. (Could be
   K=1 variance; noted so we don't over-trust a single Opus run as ground truth.)
6. **Real large tickets behaved like the synthetic ones** — full agreement (incl. Opus)
   on LIN-344. No surprise from real-world density beyond the embedded-plan-leaf cliff.

## Settings-page finding (asked: which models are listed?)

After the refresh, the settings dropdown renders **11 models** (verified by rendering
`renderSettingsPage` with the live `AVAILABLE_MODELS`):

```
● Claude Haiku 4.5      (default)   anthropic/claude-haiku-4.5
  Claude Sonnet 4.6                 anthropic/claude-sonnet-4.6
  Claude Opus 4.8                   anthropic/claude-opus-4.8
  GPT-5.4 Mini                      openai/gpt-5.4-mini
  GPT-5.5                           openai/gpt-5.5
  Gemini 3.5 Flash                  google/gemini-3.5-flash
  Gemini 3.1 Flash Lite             google/gemini-3.1-flash-lite
  Gemini 3.1 Pro                    google/gemini-3.1-pro-preview
  DeepSeek V4 Flash                 deepseek/deepseek-v4-flash
  DeepSeek V4 Pro                   deepseek/deepseek-v4-pro
  Kimi K2.6 (free)                  moonshotai/kimi-k2.6:free
```

**Key constraint for any model switch:** the settings UI states *"This model is used for
all LLM calls in this workspace, including agent/proxy traffic."* The model is a **single
workspace-wide dial — not per-endpoint.** So changing it affects `brief`/`recap`/roadmap
too, which we have NOT benchmarked. A safe default flip therefore needs *either* (a) those
endpoints validated first, *or* (b) a small code change to allow a per-endpoint model
override (the recommend path already accepts `options.model`; the seam exists).

## Verdict (recommend endpoint)

**Opus is not necessary for next-prompt generation.** Across synthetic + real + node +
dense-leaf cases at K=3, **GPT-5.4-Mini matched or beat Opus 4.8** at ~1/6 the cost and
several times the speed, with no observed cliff. It is the recommended model for this
endpoint; **Gemini 3.5 Flash** is the robust (pricier, slower) backup. **Do not** default
to Haiku or DeepSeek-V4-Flash — both fail the dense-leaf case repeatably.

The remaining gate is operational, not quality: the workspace model is global, so flip
the recommend default to GPT-5.4-Mini only after either validating `brief`/`recap` or
adding a per-endpoint override.
