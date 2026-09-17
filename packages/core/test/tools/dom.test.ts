import { expect, it } from 'vitest';
import { BrowserSession } from '../../src/mastra/tools/browserTools/BrowserSession.js';
import { composedHtml, frameAt } from '../../src/mastra/tools/browserTools/dom.js';
import { DocumentLibrary } from '../../src/documents/index.js';
import { executors } from '../../src/mastra/tools/browserTools/tools.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';

it('snapshots nested open roots and slot fallback without mutating the page', async () => {
  const session = new BrowserSession(new ProxyRegistry([new NoProxy()]));
  await session.createCursor('test');
  try {
    const { page } = await session.getCursor('test');
    await page.setContent('<div id="host"><span slot="named">Assigned once</span></div>');
    await page.evaluate(() => {
      const root = document.querySelector('#host')!.attachShadow({ mode: 'open' });
      root.innerHTML = '<slot name="named"></slot><section></section>';
      root.querySelector('section')!.attachShadow({ mode: 'open' }).innerHTML =
        '<slot>Fallback</slot>';
    });
    const html = await page.evaluate(composedHtml);
    expect(html.split('Assigned once')).toHaveLength(2);
    expect(html).toContain('Fallback');
    expect(await page.content()).not.toContain('data-shadow-root');
    expect(() => frameAt(page, [99])).toThrow('Frame path no longer exists');
    const library = new DocumentLibrary();
    const result = await executors.contentTool(library, session, {
      cursorId: 'test',
      shadowDom: true,
    });
    expect(library.get({ documentId: result.documentId })?.contentType).toBe('text/html');
  } finally {
    await session.close();
  }
});
