---
name: j-cut-editor
description: |
  Create natural J-cuts for talking-head, interview, tutorial, and product-demo edits. Use when the user asks for J-cuts, audio-led cuts, smoother transitions between takes, or when a visual cut should occur shortly after the next speaker or sentence begins. This workflow makes only justified, reviewable timeline changes and avoids duplicated audio, clipped words, and confusing topic overlaps.
user-invocable: true
---

# J-Cut Editor

## Goal

A J-cut starts the **incoming clip's audio before its picture appears**. Use it to make an edit feel motivated and continuous: the viewer hears the next idea, then sees the next shot.

This skill is for deliberate editorial transitions, not for applying J-cuts to every cut.

## Default style

Unless the user gives a different direction:

- Use J-cuts only at clear sentence or thought boundaries.
- Default audio lead: **180–280 ms**.
- Use **300–450 ms** only when the incoming line is a clear hook, answer, or reveal and the outgoing image remains relevant.
- Use a short **50–100 ms audio crossfade** when it prevents a click or abrupt room-tone shift.
- Prefer 9:16 talking-head/product-demo pacing: purposeful, clean, and natural rather than hyperactive.
- Do not use a J-cut where the outgoing picture contradicts, distracts from, or spoils the incoming spoken point.
- Do not start a J-cut mid-word, mid-breath, or during a plosive/consonant attack unless the source audio is demonstrably clean.

## Preconditions

1. Confirm the target project is open and inspect its timeline with `read_timeline` or `read_project` before changing it.
2. Identify the outgoing visual item, incoming visual item, their source assets, their source windows, and the exact visual cut frame.
3. Ensure the source is transcribed when the edit is speech-led. Use `read_transcript` or `find_transcript` to identify a natural incoming phrase boundary.
4. Determine whether the incoming video already supplies audible embedded audio. Never leave both embedded audio and an added audio-only copy audible at the same time.
5. Use a separate audio track when one is available. Create one with `edit_track` when needed.

## When to use a J-cut

Use one when all of these are true:

- The incoming audio introduces the next visual, topic, answer, or demonstration.
- The outgoing image can remain on screen briefly without becoming misleading.
- The incoming phrase has enough usable source audio before its visual in-point.
- The transition improves continuity more than a hard cut or L-cut would.

Good examples:

- The speaker says, “Here is what the dashboard actually shows,” while the talking-head shot remains for 200 ms, then the screen recording appears.
- A second take begins, “The important part is this…,” just before the camera changes to that take.
- The speaker introduces a product feature just before relevant B-roll or an app demonstration appears.

Do **not** use one for:

- Abrupt subject changes.
- A visibly mismatched facial expression or lip movement.
- A reaction shot that must be seen before its dialogue.
- An incoming source with no clean preroll.
- A moment where two voices or two music cues would compete.

## Execution workflow

### 1. Plan the transition

Before editing, record in the response or edit plan:

- outgoing item and incoming item
- exact visual cut frame
- incoming phrase being introduced
- requested or selected lead duration
- why the outgoing picture remains appropriate during the lead

If more than three J-cuts are proposed, give a compact transition plan before applying them unless the user explicitly requested unattended execution.

### 2. Create an audio-led incoming source

Use the incoming clip's source asset to create an audio-only item on an audio track.

- Place the audio item at `visualCutFrame - leadFrames`.
- Align its source window so the audio heard at `visualCutFrame` matches the audio at the incoming visual clip's source in-point.
- Include enough duration for a continuous handoff after the picture appears.
- If the source has insufficient clean preroll, reduce the lead or skip the J-cut; do not fabricate audio.
- Mute or otherwise prevent duplicate embedded audio on the incoming visual item for the covered interval. The final result must contain exactly one audible version of the incoming dialogue.

Use existing timeline/media tools such as `edit_item`, `split_item`, `set_item_timing`, and `edit_track`. Prefer an atomic `edit_item` draft with `validateOnly: true` before publishing multiple linked changes.

### 3. Preserve the outgoing visual

Keep the outgoing visual clip visible until `visualCutFrame`. Do not lengthen it beyond its natural source window merely to force a J-cut.

If appropriate, add a very short visual transition at the visual cut. Avoid fades by default in fast short-form edits; a straight cut is usually cleaner.

### 4. Audio polish

- Apply 50–100 ms fades/crossfades only when necessary to avoid clicks, room-tone jumps, or audible edits.
- Keep dialogue intelligible. Do not cover the incoming line with music, sound effects, or competing speech.
- Preserve intentional breathing room. A J-cut should create anticipation, not make the delivery feel rushed.

### 5. Validate and review

After applying the change:

1. Re-read the affected frame range with `read_timeline` or `read_project`.
2. Render or preview the surrounding 2–4 seconds.
3. Verify all of the following:
   - incoming audio begins before incoming picture
   - no duplicated dialogue occurs at the visual cut
   - no word is clipped
   - the outgoing picture remains semantically relevant during the audio lead
   - the audio transition has no click, pop, or abrupt volume jump
   - the next visual appears at a natural point in the sentence
4. If any check fails, restore or reduce the lead. Do not leave a marginal J-cut in the project.

## Defaults for common transitions

| Situation | Lead | Notes |
|---|---:|---|
| Talking head → screen recording | 220–350 ms | Start the feature explanation, then reveal the relevant UI. |
| Talking head → relevant B-roll | 180–280 ms | The incoming spoken reference should motivate the B-roll. |
| Take A → Take B, same speaker | 150–220 ms | Keep it subtle; avoid noticeable lip-sync mismatch. |
| Interview question → answer | 250–450 ms | Use only if the question image remains relevant while the answer begins. |
| Strong hook/reveal | 300–450 ms | Use sparingly and ensure the visual reveal lands with the important word. |

## Hard constraints

- Never add a J-cut solely because the user asked for a “professional” edit; use it only when it improves the storytelling.
- Never leave doubled source audio.
- Never cut a word, breath, or syllable to hit an arbitrary frame.
- Never silently alter the spoken meaning.
- Never use a black gap as a pacing device on the main video track.
- Keep the change undoable and limited to the intended transition.
- When uncertain, use a clean hard cut rather than a bad J-cut.

## Report format

After completing a J-cut pass, report:

- how many J-cuts were applied
- each transition in plain language
- lead duration used
- whether a preview was checked
- any transition skipped and why
