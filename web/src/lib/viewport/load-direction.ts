import type { LoadDirection2D } from '../store/ui.svelte';

export function requiresElementAxis(direction: LoadDirection2D): boolean {
  return direction === 'localAxial' || direction === 'localPerpendicular';
}

/** Converts the five UI directions to the existing member-load representation. */
export function elementLoadDirection(direction: LoadDirection2D, angleFromGlobalX: number): {
  angle?: number;
  isGlobal?: true;
} {
  if (direction === 'globalX') return { angle: 90, isGlobal: true };
  if (direction === 'globalZ') return { isGlobal: true };
  if (direction === 'localAxial') return { angle: 90 };
  if (direction === 'angle') return { angle: 90 - angleFromGlobalX, isGlobal: true };
  return {};
}

/** Resolves directions that do not need a member axis into global nodal components. */
export function nodalLoadComponents(
  direction: LoadDirection2D,
  magnitude: number,
  angleFromGlobalX: number,
): { fx: number; fz: number; my: number } {
  const radians = angleFromGlobalX * Math.PI / 180;
  return {
    fx: direction === 'globalX' ? magnitude : direction === 'angle' ? magnitude * Math.cos(radians) : 0,
    fz: direction === 'globalZ' ? magnitude : direction === 'angle' ? magnitude * Math.sin(radians) : 0,
    my: direction === 'moment' ? magnitude : 0,
  };
}
