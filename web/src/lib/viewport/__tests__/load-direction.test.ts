import { describe, expect, it } from 'vitest';
import { elementLoadDirection, nodalLoadComponents, requiresElementAxis } from '../load-direction';

describe('2D load direction selection', () => {
  it('maps the four named member directions without combining toggles', () => {
    expect(elementLoadDirection('globalX', 0)).toEqual({ angle: 90, isGlobal: true });
    expect(elementLoadDirection('globalZ', 0)).toEqual({ isGlobal: true });
    expect(elementLoadDirection('localAxial', 0)).toEqual({ angle: 90 });
    expect(elementLoadDirection('localPerpendicular', 0)).toEqual({});
  });

  it('treats a custom angle as counter-clockwise from global X', () => {
    expect(nodalLoadComponents('angle', 10, 30)).toEqual({
      fx: 10 * Math.cos(Math.PI / 6),
      fz: 10 * Math.sin(Math.PI / 6),
      my: 0,
    });
    expect(elementLoadDirection('angle', 30)).toEqual({ angle: 60, isGlobal: true });
  });

  it('requires a member only for the two local directions', () => {
    expect(requiresElementAxis('localAxial')).toBe(true);
    expect(requiresElementAxis('localPerpendicular')).toBe(true);
    expect(requiresElementAxis('globalX')).toBe(false);
    expect(requiresElementAxis('angle')).toBe(false);
  });
});
