import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '../model.svelte';
import { historyStore } from '../history.svelte';

beforeEach(() => {
  modelStore.clear();
  historyStore.clear();
});

describe('고립 절점 자동 정리 (요소 끝점과 절점 구분 동작)', () => {
  it('요소 도구로 자동 생성된 절점(autoCreated)은 요소 삭제 시 함께 삭제된다', () => {
    // 1. autoCreated: true인 두 절점 생성
    const a = modelStore.addNode(0, 0, 0, { autoCreated: true });
    const b = modelStore.addNode(4, 0, 0, { autoCreated: true });
    const elem = modelStore.addElement(a, b);

    expect(modelStore.nodes.has(a)).toBe(true);
    expect(modelStore.nodes.has(b)).toBe(true);
    expect(modelStore.elements.has(elem)).toBe(true);

    // 2. 요소 삭제
    modelStore.removeElement(elem);

    // 3. 요소뿐 아니라 양 끝의 autoCreated 절점도 함께 삭제됨
    expect(modelStore.elements.has(elem)).toBe(false);
    expect(modelStore.nodes.has(a)).toBe(false);
    expect(modelStore.nodes.has(b)).toBe(false);
  });

  it('사용자가 절점 도구로 직접 찍은 일반 절점은 요소를 삭제해도 유지된다', () => {
    // 1. 일반 절점(autoCreated 없음) 생성
    const a = modelStore.addNode(0, 0);
    const b = modelStore.addNode(4, 0);
    const elem = modelStore.addElement(a, b);

    // 2. 요소 삭제
    modelStore.removeElement(elem);

    // 3. 요소만 삭제되고, 사용자가 명시적으로 찍었던 절점은 영구 보존됨
    expect(modelStore.elements.has(elem)).toBe(false);
    expect(modelStore.nodes.has(a)).toBe(true);
    expect(modelStore.nodes.has(b)).toBe(true);
  });

  it('일반 절점과 자동 생성 절점이 연결된 요소를 삭제하면 자동 생성 절점만 삭제된다', () => {
    // a: 사용자 수동 절점, b: 요소 그릴 때 자동 생성된 절점
    const a = modelStore.addNode(0, 0); // manual
    const b = modelStore.addNode(4, 0, 0, { autoCreated: true }); // auto
    const elem = modelStore.addElement(a, b);

    modelStore.removeElement(elem);

    // 수동 절점 a는 보존, 자동 생성 절점 b만 삭제
    expect(modelStore.nodes.has(a)).toBe(true);
    expect(modelStore.nodes.has(b)).toBe(false);
  });

  it('두 요소가 자동 생성 절점을 공유할 때 하나만 삭제하면 공유 절점은 유지된다', () => {
    // a - b - c (모두 autoCreated)
    const a = modelStore.addNode(0, 0, 0, { autoCreated: true });
    const b = modelStore.addNode(2, 0, 0, { autoCreated: true });
    const c = modelStore.addNode(4, 0, 0, { autoCreated: true });
    const e1 = modelStore.addElement(a, b);
    const e2 = modelStore.addElement(b, c);

    // e1만 삭제
    modelStore.removeElement(e1);

    // a는 삭제되지만, b는 e2가 물고 있으므로 유지됨
    expect(modelStore.nodes.has(a)).toBe(false);
    expect(modelStore.nodes.has(b)).toBe(true);
    expect(modelStore.nodes.has(c)).toBe(true);

    // e2까지 마저 삭제
    modelStore.removeElement(e2);

    // 이제 b와 c도 모두 삭제됨
    expect(modelStore.nodes.has(b)).toBe(false);
    expect(modelStore.nodes.has(c)).toBe(false);
  });

  it('지점이나 하중이 부여된 자동 생성 절점은 요소 삭제 시 보존된다', () => {
    const a = modelStore.addNode(0, 0, 0, { autoCreated: true });
    const b = modelStore.addNode(4, 0, 0, { autoCreated: true });
    const elem = modelStore.addElement(a, b);

    // a에 고정단 지점 추가
    modelStore.addSupport(a, 'fixed');

    modelStore.removeElement(elem);

    // a는 지점이 있으므로 보존, b는 고립되었으므로 삭제됨
    expect(modelStore.nodes.has(a)).toBe(true);
    expect(modelStore.supports.size).toBe(1);
    expect(modelStore.nodes.has(b)).toBe(false);
  });

  it('요소와 절점이 함께 삭제된 후 Undo(실행 취소) 시 한 번에 모두 복구된다', () => {
    historyStore.clear();
    const a = modelStore.addNode(0, 0, 0, { autoCreated: true });
    const b = modelStore.addNode(4, 0, 0, { autoCreated: true });
    const elem = modelStore.addElement(a, b);

    modelStore.removeElement(elem);
    expect(modelStore.nodes.size).toBe(0);
    expect(modelStore.elements.size).toBe(0);

    // 단 한 번의 undo로 요소와 양 끝 절점이 모두 복구됨
    historyStore.undo();
    expect(modelStore.nodes.has(a)).toBe(true);
    expect(modelStore.nodes.has(b)).toBe(true);
    expect(modelStore.elements.has(elem)).toBe(true);
  });
});

