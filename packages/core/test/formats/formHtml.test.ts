import { load } from 'cheerio';
import { expect, it } from 'vitest';
import { collapseHtml, slimHtml } from '../../src/formats.js';

it('preserves form semantics, structured data, escaping and canonical links', () => {
  const html =
    '<html><head><script type="application/ld+json">{"title":"Job"}</script><link rel="canonical" href="/job"></head><body><div id="outer"><form><div><label for="cv">CV</label><input id="cv" name="resume" type="file" required accept=".pdf"><input name="name" value="a &quot;b&quot;"><select name="country"><option selected>Sweden</option></select></div></form></div></body></html>';
  const slim = slimHtml({ html, url: 'https://example.test' });
  const $ = load(collapseHtml(slim));
  expect($('input[type=file][required]').attr('accept')).toBe('.pdf');
  expect($('label[for=cv]').text()).toBe('CV');
  expect($('input[name=name]').attr('value')).toBe('a "b"');
  expect($('option[selected]').text()).toBe('Sweden');
  expect($('script[type="application/ld+json"]').length).toBe(1);
  expect($('link').attr('href')).toBe('https://example.test/job');
  expect(slim).not.toContain('</input>');
  expect(slim.match(/<html>/g)).toHaveLength(1);
});

it('keeps collapsed selector attributes and expands requested regions', () => {
  const html = '<div id="jobs" class="list"><div id="details">A job</div></div>';
  expect(load(collapseHtml(html))('#jobs.list').length).toBe(1);
  expect(load(collapseHtml(html, ['d0']))('#details').length).toBe(1);
});
