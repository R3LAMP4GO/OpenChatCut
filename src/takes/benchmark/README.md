# Take-detection benchmark

Record one 10–15 minute webcam or phone talking-head take from `mock-footage-script.md`. Use one speaker, natural pacing, and preserve every mistake and marked pause. Do not read the script into any benchmark runner.

Import the resulting video, then run:

```sh
npm run benchmark:take-detection -- --video /absolute/path/video.mp4 --provider local --language en
```

The runner invokes the production ASR provider and writes raw ASR separately from labels. It rejects the authored placeholder labels until a human checks the captured transcript and explicitly rebinds recording ID, source revision, and generation ID. No automatic video is included: a human-recorded fixture avoids fabricated TTS timing and remains reproducible through the recording sheet and captured ASR artifact.
