import assert from 'node:assert/strict';
import {
  PARAKEET_INFERENCE_CONTRACT,
  isParakeetInferenceResponse,
  parseParakeetInferenceRequest,
} from './parakeet-inference.ts';

const request = parseParakeetInferenceRequest({
  requestId: 'parakeet-1234',
  contractId: PARAKEET_INFERENCE_CONTRACT.id,
  sourcePath: '/media/uploads/recording%20one.wav',
  language: 'EN-us',
});
assert.equal(request.language, 'en-US');
assert.throws(() => parseParakeetInferenceRequest({ ...request, sourcePath: '/media/uploads/../secret.wav' }));
assert.throws(() => parseParakeetInferenceRequest({ ...request, sourcePath: '/media/uploads/clip.wav?x=1' }));
assert.throws(() => parseParakeetInferenceRequest({ ...request, language: 'fr' }));
assert.throws(() => parseParakeetInferenceRequest({ ...request, requestId: 'short' }));

assert.equal(isParakeetInferenceResponse({
  requestId: request.requestId,
  text: 'Hello world',
  chunks: [{ text: 'Hello', start: 0, end: 0.4 }],
}), true);
assert.equal(isParakeetInferenceResponse({
  requestId: request.requestId,
  text: 'Hello',
  chunks: [{ text: 'Hello', start: 1, end: 0 }],
}), false);
