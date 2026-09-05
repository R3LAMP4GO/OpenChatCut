import { sourceWindowForTimelineRange } from '../editor/sourceLimit';
import type { TimelineItem } from '../editor/types';
import { hasOperationalTranscript } from './types';
import { itemEditOpts, itemWindow, keptSegments, usesEditedWordFlow } from './edit';

export interface VisibleSegment {
  parentId: string;
  ordinal: number;
  sourceStartFrame: number;
  sourceEndFrame: number;
  startFrame: number;
  durationInFrames: number;
}

/** Timeline boxes and render sequences derived from one persisted media item. */
export function visibleSegments(item: TimelineItem, fps: number): VisibleSegment[] {
  if (!hasOperationalTranscript(item) || !usesEditedWordFlow(item)) {
    const source = sourceWindowForTimelineRange(item, 0, item.durationInFrames);
    return [{
      parentId: item.id,
      ordinal: 0,
      sourceStartFrame: source.startFrame,
      sourceEndFrame: source.endFrame,
      startFrame: item.startFrame,
      durationInFrames: item.durationInFrames,
    }];
  }

  return keptSegments(item.transcript, new Set(item.deletedWordIdx ?? []), fps, item.startFrame, {
    ...itemEditOpts(item),
    window: itemWindow(item),
  }).map((segment, ordinal) => ({
    parentId: item.id,
    ordinal,
    sourceStartFrame: segment.srcStartFrame,
    sourceEndFrame: segment.srcEndFrame,
    startFrame: segment.fromFrame,
    durationInFrames: segment.durFrames,
  }));
}
