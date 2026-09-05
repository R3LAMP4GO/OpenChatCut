/** Only a pressed six-dot handle may begin a speech-block drag. */
export function canStartSpeechReorder(canReorder: boolean, armedHandle: number | null, speechOrdinal: number): boolean {
  return canReorder && armedHandle === speechOrdinal;
}
