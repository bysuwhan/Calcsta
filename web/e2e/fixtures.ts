import { test as base, expect, type Page } from '@playwright/test';

/** Shared Playwright helpers for the Basic 2D editor. */
export const test = base;
export { expect };

export interface TestHooks {
  solverReady(): boolean;
  solveCount(): number;
  modelVersion(): number;
  selection(): number[];
  selectionByKind(): Record<string, number[]>;
  currentTool(): string;
  armedKinds(): string[];
  nodeCount(): number;
  supportCount(): number;
  elementIds(): number[];
  nodeScreenPos(id: number): { x: number; y: number } | null;
  sectionNames(): string[];
  canvasInkRatio(): number;
  diagramType(): string;
  hasResults?(): boolean;
  [key: string]: unknown;
}

export interface TestActions {
  loadExample(name: string): Promise<void>;
  solve(): Promise<void>;
}

declare global {
  interface Window {
    __stabileo: TestHooks;
    __stabileoActions: TestActions;
  }
}

export function hook<T>(page: Page, fn: (h: TestHooks) => T): Promise<T> {
  return page.evaluate(fn as never, undefined as never) as never;
}

/** Load a 2D fixture through the same action used by the examples panel. */
export async function loadModel(page: Page, name: string): Promise<number[]> {
  await page.evaluate(async (n) => { await window.__stabileoActions.loadExample(n); }, name);
  await expect.poll(() => page.evaluate(() => window.__stabileo.elementIds().length), { timeout: 60_000 })
    .toBeGreaterThan(0);
  return page.evaluate(() => window.__stabileo.elementIds());
}

/** Solve through the Basic action and wait for the solve counter to advance. */
export async function solveModel(page: Page): Promise<void> {
  const before = await page.evaluate(() => window.__stabileo.solveCount());
  await page.evaluate(async () => { await window.__stabileoActions.solve(); });
  await expect.poll(() => page.evaluate(() => window.__stabileo.solveCount()), { timeout: 90_000 })
    .toBeGreaterThan(before);
}
