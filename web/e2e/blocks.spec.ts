import { test, expect, type Page } from '@playwright/test';

async function read(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/lib/store/index.ts'; const { modelStore, uiStore } = await import(/* @vite-ignore */ path);
    return { blocks: JSON.parse(JSON.stringify(modelStore.blocks)), nodes: [...modelStore.nodes.values()], loads: modelStore.loads,
      editing: modelStore.editingBlockId, elements: [...modelStore.elements.values()], tool: uiStore.currentTool };
  });
}
async function point(page: Page, x: number, y: number) {
  const pos = await page.evaluate(async ({ x, y }) => {
    const path = '/src/lib/store/index.ts'; const { uiStore } = await import(/* @vite-ignore */ path);
    return uiStore.worldToScreen(x, y);
  }, { x, y });
  const box = await page.locator('canvas').first().boundingBox();
  return { x: box!.x + pos.x, y: box!.y + pos.y };
}
async function click(page: Page, x: number, y: number) { const p = await point(page, x, y); await page.mouse.click(p.x, p.y); }
async function seed(page: Page) {
  await page.goto('/app/basic');
  await expect(page.getByTestId('block-panel')).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/lib/store/index.ts'; const { modelStore: m, uiStore: u, historyStore: h } = await import(/* @vite-ignore */ path);
    m.clear(); const a = m.addNode(0, 0), b = m.addNode(2, 0); const e = m.addElement(a, b);
    m.addNode(5, 1); u.currentTool = 'select'; u.clearSelection(); u.selectElement(e);
    u.zoom = 70; u.panX = 130; u.panY = 350; u.snapToGrid = false; h.clear();
  });
}
async function create(page: Page) {
  await page.getByRole('button', { name: '블록 만들기', exact: true }).click();
  await expect(page.getByTestId('block-row-1')).toContainText('블록 1');
  await page.getByTestId('block-row-1').getByRole('button', { name: '블록 1', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click();
  await page.getByRole('textbox', { name: '새 블록 이름', exact: true }).fill('링크');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByTestId('block-row-1')).toContainText('링크');
}

test('create, move and snap a pin, cancel preview, rotate by two reference points', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await seed(page); await create(page);
  await page.getByRole('button', { name: '이동', exact: true }).click();
  await click(page, 1, 0); await click(page, 2, 0); await click(page, 5, 1);
  await expect.poll(async () => (await read(page)).blocks.joints.length).toBe(1);
  await page.getByRole('button', { name: '이동', exact: true }).click();
  await click(page, 4, 1); await click(page, 5, 1);
  const p = await point(page, 6, 2); await page.mouse.move(p.x, p.y); await page.keyboard.press('Escape');
  expect((await read(page)).blocks.instances[0].x).toBeCloseTo(3);
  expect((await read(page)).blocks.joints).toHaveLength(1);
  await page.getByRole('button', { name: '회전', exact: true }).click();
  await click(page, 4, 1); await click(page, 3, 1); await click(page, 5, 1); await click(page, 3, 3);
  const after = await read(page);
  expect(after.blocks.instances[0].angle).toBeCloseTo(Math.PI / 2, 2); expect(after.blocks.joints).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('linked duplication, context independence, editing isolation and visibility', async ({ page }) => {
  await seed(page); await create(page);
  await page.getByTestId('block-row-1').getByRole('button', { name: '링크', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '복제', exact: true }).click();
  await click(page, 0, 0); await click(page, 0, 3);
  await expect(page.getByTestId('block-row-2')).toBeVisible();
  await page.getByTestId('block-row-2').getByRole('button').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '독립시키기' }).click();
  const independent = await read(page); expect(independent.blocks.instances[0].definitionId).not.toBe(independent.blocks.instances[1].definitionId);
  await page.getByTestId('block-row-1').getByRole('button').dblclick();
  await expect(page.getByTestId('block-edit-banner')).toBeVisible();
  const p = await point(page, 2, 0); await page.mouse.dblclick(p.x, p.y);
  const editor = page.locator('.editor').filter({ has: page.getByRole('button', { name: 'OK', exact: true }) });
  await expect(editor).toBeVisible(); await editor.locator('input').first().fill('3');
  await editor.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByRole('button', { name: '블록 편집 완료' }).click();
  const after = await read(page); expect(after.nodes.find((n: { id: number }) => n.id === 2)?.x).toBe(3);
  await page.getByTestId('block-row-1').getByRole('checkbox').uncheck();
  expect((await read(page)).nodes.some((n: { id: number }) => n.id === 2)).toBe(false);
  await page.getByTestId('block-row-1').getByRole('checkbox').check();
  await page.screenshot({ path: 'e2e/.artifacts/blocks/workspace.png' });
});

test('double-clicking a block node enters block edit without opening node properties', async ({ page }) => {
  await seed(page); await create(page);

  const blockNode = await point(page, 2, 0);
  const before = await read(page);
  await page.mouse.dblclick(blockNode.x, blockNode.y);
  await expect(page.getByTestId('node-connection-editor')).toBeHidden();
  await expect(page.getByTestId('block-edit-controls')).toBeVisible();
  expect((await read(page)).editing).toBe(1);
  expect((await read(page)).blocks.instances[0]).toMatchObject({ x: before.blocks.instances[0].x, y: before.blocks.instances[0].y });

  await page.getByRole('button', { name: '블록 편집 취소' }).click();
  expect((await read(page)).editing).toBeNull();
});
