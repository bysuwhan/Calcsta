export const NODE_DRAG_THRESHOLD_PX = 10;

export function exceedsNodeDragThreshold(
  start: { x: number; y: number },
  current: { x: number; y: number },
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > NODE_DRAG_THRESHOLD_PX;
}
