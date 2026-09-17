import { describe, expect, it } from 'vitest';
import { exceedsNodeDragThreshold, NODE_DRAG_THRESHOLD_PX } from '../node-drag';

describe('node drag threshold', () => {
  const start = { x: 100, y: 50 };

  it('does not start while pointer travel is 10 px or less', () => {
    expect(NODE_DRAG_THRESHOLD_PX).toBe(10);
    expect(exceedsNodeDragThreshold(start, { x: 106, y: 58 })).toBe(false);
    expect(exceedsNodeDragThreshold(start, { x: 110, y: 50 })).toBe(false);
  });

  it('starts as soon as pointer travel exceeds 10 px', () => {
    expect(exceedsNodeDragThreshold(start, { x: 110.01, y: 50 })).toBe(true);
  });
});
