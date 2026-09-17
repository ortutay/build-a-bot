import { createServer } from 'node:http';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DocumentLibrary } from '../../src/documents/DocumentLibrary.js';
import { BrowserSession } from '../../src/mastra/tools/browserTools/BrowserSession.js';
import { BrowserToolCache } from '../../src/mastra/tools/browserTools/BrowserToolCache.js';
import {
  inspectElements,
  inspectionMaxChars,
  inspectResultSchema,
} from '../../src/mastra/tools/browserTools/elements.js';
import { createTools, executors } from '../../src/mastra/tools/browserTools/tools.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';
import { MemoryCache } from '../lib/MemoryCache.js';

let session: BrowserSession;
const library = new DocumentLibrary();
beforeEach(async () => {
  session = new BrowserSession(new ProxyRegistry([new NoProxy()]));
  await session.createCursor('test');
});
afterEach(async () => {
  await session.close();
});
const inspect = (input: Record<string, unknown>) =>
  executors.inspectElementsTool(library, session, { cursorId: 'test', ...input });

it('reads live values separately from unchanged HTML attributes without interpreting labels', async () => {
  const { page } = await session.getCursor('test');
  await page.setContent(
    '<label>Quantity *Required<input value="1"></label><input type="checkbox" checked><select><option selected>A</option><option>B</option></select>'
  );
  await page.locator('input').first().fill('3');
  await page.locator('[type=checkbox]').uncheck();
  await page.locator('select').selectOption({ label: 'B' });
  const before = await page.content();
  const result = await inspect({
    selector: 'input,select,option',
    properties: ['value', 'checked', 'selected', 'selectedIndex'],
  });
  expect(result.elements[0]).toMatchObject({
    attributes: { value: '1' },
    properties: {
      value: { status: 'ok', value: '3' },
      selected: { status: 'unavailable', reason: 'missing' },
    },
  });
  expect(result.elements[1]).toMatchObject({
    attributes: { checked: '' },
    properties: { checked: { value: false } },
  });
  expect(result.elements[2].properties.selectedIndex.value).toBe(1);
  expect(result.elements[3]).toMatchObject({
    attributes: { selected: '' },
    properties: { selected: { value: false } },
  });
  expect(result.elements[4].properties.selected.value).toBe(true);
  expect(await page.content()).toBe(before);
  expect((await inspect({ selector: 'input' })).elements[0].properties).toEqual({});
  expect(inspectResultSchema.safeParse(result).success).toBe(true);
});

it('handles primitive, missing, unsupported and throwing properties independently', async () => {
  const { page } = await session.getCursor('test');
  await page.setContent('<div></div>');
  await page.locator('div').evaluate((el) => {
    Object.defineProperties(el, {
      custom: { value: 'observed' },
      nothing: { value: null },
      bad: {
        get() {
          throw new Error('unreadable');
        },
      },
      nonfinite: { value: Infinity },
      unset: { value: undefined },
      callback: {
        value: () => {
          throw new Error('must not call');
        },
      },
    });
  });
  const { elements } = await inspect({
    selector: 'div',
    properties: [
      'custom',
      'nothing',
      'bad',
      'nonfinite',
      'unset',
      'callback',
      'style',
      'missing',
      'style.color',
      'custom',
    ],
  });
  expect(elements[0].properties).toMatchObject({
    custom: { status: 'ok', value: 'observed' },
    nothing: { status: 'ok', value: null },
    bad: { reason: 'read-failed' },
    nonfinite: { reason: 'unsupported-type' },
    unset: { reason: 'unsupported-type' },
    callback: { reason: 'unsupported-type' },
    style: { reason: 'unsupported-type' },
    missing: { reason: 'missing' },
    'style.color': { reason: 'missing' },
  });
});

it('supports open shadow roots, frames and visibility', async () => {
  const { page } = await session.getCursor('test');
  await page.setContent('<div id="host"></div><iframe srcdoc="<input value=inside>"></iframe>');
  await page.locator('#host').evaluate((el) => {
    el.attachShadow({ mode: 'open' }).innerHTML = '<input value="shadow"><input hidden>';
  });
  const shadow = await inspect({ selector: 'input', properties: ['value'] });
  expect(shadow.elements.map((el: { visible: boolean }) => el.visible)).toEqual([true, false]);
  expect(shadow.elements[0].properties.value.value).toBe('shadow');
  await page.frameLocator('iframe').locator('input').waitFor();
  await executors.fillTool(library, session, {
    cursorId: 'test',
    framePath: [0],
    selector: 'input',
    value: 'changed',
  });
  await executors.pressTool(library, session, {
    cursorId: 'test',
    framePath: [0],
    selector: 'input',
    key: 'End',
  });
  const framed = await inspect({
    framePath: [0],
    selector: 'input',
    properties: ['value', 'selectionStart'],
  });
  expect(framed.elements[0].properties).toMatchObject({
    value: { value: 'changed' },
    selectionStart: { value: 7 },
  });
});

it('bounds observations and marks shortened content and omitted matches', async () => {
  const { page } = await session.getCursor('test');
  await page.setContent('<main></main>');
  await page.locator('main').evaluate((el) => {
    for (let i = 0; i < 100; i++) {
      const child = document.createElement('div');
      child.textContent = 'x'.repeat(20000);
      child.setAttribute('data-long', 'a'.repeat(500));
      Object.defineProperty(child, 'long', { value: 'b'.repeat(3000) });
      el.append(child);
    }
  });
  const result = await inspect({ selector: 'div', limit: 100, properties: ['long'] });
  expect(result.matched).toBe(100);
  expect(result.elements.length).toBeGreaterThan(0);
  expect(result.elements.length).toBeLessThan(100);
  expect(result.truncated).toBe(true);
  expect(result.elements[0].truncated).toEqual(
    expect.arrayContaining(['text', 'outerHTML', 'attributes.data-long', 'properties.long'])
  );
  expect(result.elements[0].properties.long.truncated).toBe(true);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(inspectionMaxChars);
  expect((await inspect({ selector: 'div', limit: 1 })).elements).toHaveLength(1);
  expect(await inspect({ selector: 'absent' })).toEqual({
    matched: 0,
    elements: [],
    truncated: false,
  });
});

it('validates bounds and requires unique interaction targets', async () => {
  const { page } = await session.getCursor('test');
  await page.setContent('<input><input>');
  await expect(
    inspectElements(page.mainFrame(), { selector: 'input', limit: 101 })
  ).rejects.toThrow();
  await expect(
    inspect({ selector: 'input', properties: Array(21).fill('value') })
  ).rejects.toThrow();
  await expect(
    executors.fillTool(library, session, {
      cursorId: 'test',
      selector: 'input',
      value: 'x',
      timeout: 100,
    })
  ).rejects.toThrow('strict mode');
  await expect(
    executors.pressTool(library, session, {
      cursorId: 'test',
      selector: 'input',
      key: 'Escape',
      timeout: 100,
    })
  ).rejects.toThrow('strict mode');
});

it('replays cached fills and key presses before an uncached inspection', async () => {
  let requests = 0;
  const server = createServer((_req, resp) => {
    requests++;
    resp.setHeader('content-type', 'text/html');
    resp.end(
      '<form onsubmit="event.preventDefault();this.dataset.submitted=1"><input value="initial" onkeydown="this.dataset.key=event.key"></form>'
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const tools = await createTools({
      documentLibrary: library,
      browserSession: session,
      proxyRegistry: session.proxyRegistry,
      cache: new BrowserToolCache(new MemoryCache()),
    });
    const execute = async (name: string, input: Record<string, unknown> = {}): Promise<any> =>
      tools[`browserTools_${name}Tool`].execute!(input, {} as any);
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    const warm = await execute('newPage');
    await execute('goto', { cursorId: warm.cursorId, url });
    await execute('fill', { cursorId: warm.cursorId, selector: 'input', value: 'edited' });
    await execute('press', { cursorId: warm.cursorId, selector: 'input', key: 'Escape' });
    const baseline = requests;
    const cold = await execute('newPage');
    await execute('goto', { cursorId: cold.cursorId, url });
    await execute('fill', { cursorId: cold.cursorId, selector: 'input', value: 'edited' });
    await execute('press', { cursorId: cold.cursorId, selector: 'input', key: 'Escape' });
    expect(requests).toBe(baseline);
    const result = await execute('inspectElements', {
      cursorId: cold.cursorId,
      selector: 'input',
      properties: ['value'],
    });
    expect(requests).toBeGreaterThan(baseline);
    expect(result.elements[0]).toMatchObject({
      attributes: { value: 'initial', 'data-key': 'Escape' },
      properties: { value: { value: 'edited' } },
    });
    const form = await execute('inspectElements', { cursorId: cold.cursorId, selector: 'form' });
    expect(form.elements[0].attributes['data-submitted']).toBeUndefined();
  } finally {
    await session.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
