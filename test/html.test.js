import { describe, expect, test } from 'vitest';
import { collapseHtml, inspect, slimHtml } from '../src/html.js';

test('collapseHtml removes noise and caps collapsed text previews', () => {
  const output = collapseHtml(`
    <div class="layout" style="color: red">
      ${'x'.repeat(600)}
      <svg><path /></svg>
      <script>window.noise = true;</script>
    </div>
  `);
  const preview = output.match(/\] ([^<]*)<\/div>/)?.[1];

  expect(output).toContain('data-collapse-id="d0"');
  expect(output).not.toContain('<svg');
  expect(output).not.toContain('<script');
  expect(output).not.toContain('class=');
  expect(output).not.toContain('style=');
  expect(preview).toMatch(/…$/);
  expect(Buffer.byteLength(preview, 'utf8')).toBeLessThanOrEqual(500);
});

test('collapseHtml preserves attributes on expanded divs', () => {
  const output = collapseHtml(
    `<div id="parent" class="layout" data-page="catalog">
      <div id="first" class="featured" data-item="first">First child</div>
      <div id="second" class="secondary" data-item="second">Second child</div>
    </div>`,
    { d1: { expand: true } }
  );

  expect(output).toContain('\n  <div');
  expect(output).not.toContain('[collapsed d0;');
  expect(output).toContain('id="parent"');
  expect(output).toContain('class="layout"');
  expect(output).toContain('data-page="catalog"');
  expect(output).toContain('id="first"');
  expect(output).toContain('class="featured"');
  expect(output).toContain('data-item="first"');
  expect(output).toContain('[collapsed d2; 0 elements] Second child');
});

test('collapseHtml accepts a list of IDs to expand', () => {
  const output = collapseHtml('<div><div>Opened from a list</div></div>', ['d1']);
  expect(output).not.toContain('[collapsed d0;');
  expect(output).toContain('Opened from a list');
});

test('inspect returns a formatted, cleaned collapse subtree', () => {
  const output = inspect(
    `<div id="root">
      <div id="first">First child</div>
      <div id="target"><section><p>Target details</p></section><script>noise</script></div>
    </div>`,
    'd2'
  );

  expect(output).toContain('id="target"');
  expect(output).toContain('data-collapse-id="d2"');
  expect(output).toContain('\n  <section>\n    <p>Target details</p>');
  expect(output).not.toContain('id="root"');
  expect(output).not.toContain('<script');
});

test('slimHtml normalizes local links without retaining scripts', () => {
  const output = slimHtml({
    html: '<main><a href="/products">Products</a><script>ignored()</script></main>',
    url: 'https://example.com/catalog',
  });

  expect(output).toContain('href="https://example.com/products"');
  expect(output).not.toContain('ignored');
});
