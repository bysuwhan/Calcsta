import { unitLabel } from '../utils/units';

export const COLOUR_RAMP_STOPS: ReadonlyArray<{ at: number; rgb: readonly [number, number, number] }> = [
  { at: 0, rgb: [0, 255, 200] }, { at: 0.25, rgb: [0, 255, 0] },
  { at: 0.5, rgb: [255, 255, 0] }, { at: 0.75, rgb: [255, 128, 0] }, { at: 1, rgb: [255, 0, 0] },
];
export const OVER_SCALE_RGB: readonly [number, number, number] = [255, 0, 255];
export function colourRampRgb(norm: number): [number, number, number] {
  if (norm > 1) return [...OVER_SCALE_RGB] as [number, number, number];
  const t = Math.max(0, norm);
  for (let i = 1; i < COLOUR_RAMP_STOPS.length; i++) {
    const hi = COLOUR_RAMP_STOPS[i]; if (t <= hi.at) { const lo = COLOUR_RAMP_STOPS[i - 1]; const k = (t - lo.at) / (hi.at - lo.at); return [0, 1, 2].map(c => Math.round(lo.rgb[c] + (hi.rgb[c] - lo.rgb[c]) * k)) as [number, number, number]; }
  }
  const top = COLOUR_RAMP_STOPS[COLOUR_RAMP_STOPS.length - 1].rgb; return [top[0], top[1], top[2]];
}
export function colourRampCss(norm: number) { const [r, g, b] = colourRampRgb(norm); return `rgb(${r},${g},${b})`; }
export function colourMapUnit(kind: string) {
  if (kind === 'stressRatio') return '';
  if (kind === 'vonMises' || kind === 'sigmaMax' || kind === 'tauMax') return unitLabel('stress', 'SI');
  if (kind === 'moment' || kind === 'momentY' || kind === 'momentZ' || kind === 'torsion') return 'kN·m';
  return 'kN';
}
