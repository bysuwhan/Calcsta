import { describe, expect, it } from 'vitest';
import ko from '../locales/ko';
import koApp from '../locales/ko-app';

describe('Korean structural terminology', () => {
  it('uses 지지점 for structural supports', () => {
    expect(ko['toolbar.support']).toBe('지지점');
    expect(ko['tooltip.supPinned.title']).toBe('핀지지점');
    expect(ko['kinematic.supportReactions']).toContain('지지점 반력');
    expect(koApp['footing.ui.noSupports']).toContain('지지점');
  });

  it('preserves 지점 when it means a location rather than a support', () => {
    expect(ko['advHelp.plastic.text']).toContain('도달하는 지점에서');
    expect(ko['advHelp.plastic.text']).not.toContain('도달하는 지지점에서');
    expect(koApp['cad.roleGuide.column']).toContain('수직 지점을');
  });

  it('uses 점 and 선 for user-facing node and element terminology', () => {
    expect(ko['float.node']).toBe('점');
    expect(ko['float.element']).toBe('선');
    expect(ko['config.nodeIds']).toBe('점 ID');
    expect(ko['config.elementIds']).toBe('선 ID');
    expect(koApp['sketch.fixedHint']).toContain('점은 위치를 고정하고, 선은 각도와 기준선을');
  });
});
