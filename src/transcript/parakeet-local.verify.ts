import assert from 'node:assert/strict';
import { parseParakeetResponse, transcribeWithParakeet } from './parakeet-local.ts';

assert.deepEqual(parseParakeetResponse({
  text: 'Hello world',
  chunks: [
    { text: ' Hello ', start: 0, end: 1 },
    { text: 'world', start: 0.25, end: 0.6 },
  ],
}), {
  text: 'Hello world',
  chunks: [
    { text: 'Hello', start: 0, end: 250 },
    { text: 'world', start: 250, end: 600 },
  ],
});

await assert.rejects(
  transcribeWithParakeet('/media/uploads/clip.mp3', 'fr'),
  /English transcription only/,
);
await assert.rejects(
  transcribeWithParakeet('https://example.invalid/clip.mp3', 'en'),
  /locally uploaded media file/,
);
