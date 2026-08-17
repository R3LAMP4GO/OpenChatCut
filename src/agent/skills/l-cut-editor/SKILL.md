---
name: l-cut-editor
description: Create natural L-cuts for dialogue, interviews, tutorials, and scene changes by continuing the outgoing clip's audio beneath the incoming picture.
---

# L-cut editor

Use this workflow when the user asks for an L-cut, an audio-lag cut, smoother dialogue handoffs, or for the previous scene's sound to continue after the picture changes.

## Editorial definition

An L-cut means:

- the **picture cuts first** to the incoming scene;
- the **outgoing clip's audio continues** beneath the incoming picture;
- on the timeline, the outgoing audio extends to the right of its picture, forming an **L** shape.

Do not confuse it with a J-cut. A J-cut starts the incoming audio before its picture. An L-cut keeps the outgoing audio after its picture ends.

## Default behavior

- Start with a 0.5-second audio tail, quantized to whole timeline frames.
- Use 0.2–0.4 seconds for quick dialogue continuity, 0.5–1 second for a natural phrase handoff, and 1–2 seconds for a full phrase, reaction, or environmental bridge.
- Follow dialogue or ambience phrasing when that gives a cleaner endpoint.
- Do not exceed 2 seconds unless the user requests it or the outgoing phrase clearly needs more room.
- Preserve source synchronization: at the picture cut, the audio-only outgoing source frame must equal the source frame immediately after the outgoing visual endpoint.
- Avoid competing dialogue. During the overlap, mute only the incoming visual segment's embedded audio unless intentional ambience mixing is requested.

## Required inspection

Before editing, use `read_project` to identify:

1. the outgoing visual clip;
2. the incoming visual clip;
3. their picture-cut frame;
4. the outgoing source frame at that cut;
5. available outgoing source media after the visual endpoint;
6. whether the incoming clip has dialogue or important sound during the overlap.

If the outgoing source has no usable audio after the picture endpoint, report that an L-cut cannot be made from that boundary rather than fabricating audio.

## Mutation sequence

Use the deterministic split-edit tools rather than manually calculating or sequencing low-level edits.

1. Call `plan_split_edit` with `type: "l-cut"`, the adjacent outgoing/incoming item IDs, and the selected `durationSeconds`.
2. Review its quantized duration, post-roll availability, audio track, muted interval, and `planRef`.
3. Call `apply_split_edit` with the exact same inputs plus that `planRef`.

The executor creates the outgoing raw audio-only tail, begins it exactly where the outgoing visual source ends, splits and mutes only the overlapping incoming visual segment, resumes incoming embedded audio afterward, validates track overlap and source handles, and commits one undoable batch. Do not place a second copy beneath the outgoing picture; its visual clip already supplies that audio. Do not reproduce this geometry with `edit_item` unless the deterministic tool explicitly reports an unsupported case.

## Frame math

For timeline fps `F` and desired tail `T` seconds:

```text
tailFrames = round(T * F)
audioStartFrame = pictureCutFrame
audioEndFrame = pictureCutFrame + tailFrames
audioSourceStartFrame = outgoingVisual.srcInFrame + outgoingVisual.durationInFrames
```

At the cut, assert:

```text
audioSourceStartFrame == outgoingVisual.srcInFrame + outgoingVisual.durationInFrames
```

## Validation checklist

After applying, use `read_project` and confirm:

- the incoming picture begins at the intended cut frame;
- the outgoing audio-only item begins at that cut and extends right beneath the incoming picture;
- its source starts exactly where the outgoing visual source ended;
- only one intended dialogue source is audible during the overlap;
- incoming embedded audio resumes after the tail when it should;
- no timeline gap, duplicate dialogue, or accidental picture shift was introduced.

Finish with one concise sentence stating the picture-cut frame and outgoing-audio tail duration.
