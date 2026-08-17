import { parse } from 'node-html-parser';
import pretty from 'pretty';

export const defaultRemoveTags = [
  'style',
  'svg',
  'symbol',
  'link',
  'noscript',
  'template',
  'iframe',
  'canvas',
];

export const defaultRemoveAttributes = ['style', 'srcset'];

const parseHtml = (html) => parse(html || '', { comment: true });

const removeNoise = (root) => {
  root
    .querySelectorAll([...defaultRemoveTags, 'script'].join(', '))
    .forEach((node) => node.remove());
  return root;
};

const cleanAttributes = (root, attributes = defaultRemoveAttributes) => {
  const visit = (node) => {
    if (!node?.childNodes) return;

    for (const attribute of Object.keys(node.attributes || {})) {
      if (attributes.includes(attribute)) {
        node.removeAttribute(attribute);
      } else if ((node.attributes[attribute] || '').length > 400) {
        node.setAttribute(attribute, node.attributes[attribute].slice(0, 400));
      }
    }

    node.childNodes.forEach(visit);
  };

  visit(root);
  return root;
};

const absoluteUrls = (root, url) => {
  if (!url) return root;

  const attrsToFix = { a: 'href', img: 'src', source: 'src', script: 'src' };
  const visit = (node) => {
    const attribute = attrsToFix[(node.tagName || '').toLowerCase()];
    const value = attribute && node.getAttribute?.(attribute);

    if (value && !/^(?:[a-z]+:|#)/i.test(value)) {
      try {
        node.setAttribute(attribute, new URL(value, url).toString());
      } catch {
        // Leave malformed URLs unchanged.
      }
    }

    node.childNodes?.forEach(visit);
  };

  visit(root);
  return root;
};

export const remove = (html, tags = defaultRemoveTags, attributes = defaultRemoveAttributes) => {
  const root = parseHtml(html);
  root.querySelectorAll(tags.join(', ')).forEach((node) => node.remove());
  return cleanAttributes(root, attributes).toString();
};

export const drop = (html, levels = 2, limit = 16) => {
  const shape = (node, depth) => {
    if (depth === 0) return '';
    return `{${node.tagName || '.'}${(node.childNodes || [])
      .map((child) => shape(child, depth - 1))
      .join('')}}`;
  };

  const prune = (parent, children) => {
    const edge = Math.floor(limit / 2);
    if (children.length <= edge * 2) return;

    let bytes = 0;
    const omitted = children.slice(edge, children.length - edge);
    for (const child of omitted) {
      bytes += Buffer.byteLength(child.toString(), 'utf8');
      parent.removeChild(child);
    }

    const anchor = children[children.length - edge];
    if (anchor) {
      anchor.before(
        parse(`<!-- dropped ${omitted.length} nodes of ${bytes} bytes for context reduction -->`, {
          comment: true,
        })
      );
    }
  };

  const visit = (node) => {
    const groups = new Map();
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) continue;
      const key = shape(child, levels);
      groups.set(key, [...(groups.get(key) || []), child]);
    }
    for (const children of groups.values()) prune(node, children);
    node.childNodes?.forEach(visit);
  };

  const root = parseHtml(html);
  visit(root);
  return root
    .toString()
    .replaceAll(/^[ \t]+$/gm, '')
    .replaceAll(/\n+/g, '\n');
};

export const collapseHtml = (html, shouldExpand = []) => {
  const previewText = (text, maxBytes = 500) => {
    const suffix = '…';
    const limit = maxBytes - Buffer.byteLength(suffix, 'utf8');
    let bytes = 0;
    let output = '';

    for (const char of (text || '').replace(/\s+/g, ' ').trim()) {
      const size = Buffer.byteLength(char, 'utf8');
      if (bytes + size > limit) return `${output}${suffix}`;
      output += char;
      bytes += size;
    }

    return output;
  };

  const root = removeNoise(cleanAttributes(parseHtml(html)));
  const expansionRules = new Map(
    Array.isArray(shouldExpand)
      ? shouldExpand.map((id) => [id, {}])
      : Object.entries(shouldExpand || {})
  );
  const divs = root.querySelectorAll('div');
  const refs = new Map(divs.map((div, index) => [div, `d${index.toString(36)}`]));
  const open = new Set();

  for (const div of divs) {
    if (!expansionRules.has(refs.get(div))) continue;
    for (let node = div; node; node = node.parentNode) {
      if (refs.has(node)) open.add(node);
    }
  }

  const visible = divs.filter((div) => {
    for (let node = div.parentNode; node; node = node.parentNode) {
      if (refs.has(node) && !open.has(node)) return false;
    }
    return true;
  });

  for (const div of visible) {
    const ref = refs.get(div);
    if (open.has(div)) {
      div.setAttribute('data-collapse-id', ref);
      continue;
    }

    const summary = `[collapsed ${ref}; ${div.childElementCount} elements]`;
    const preview = previewText(div.text);
    div.setAttributes({ 'data-collapse-id': ref });
    div.set_content('');
    div.append(preview ? `${summary} ${preview}` : summary);
  }

  return pretty(root.toString(), { ocd: true, indent_size: 2 }).trim();
};

export const inspect = (html, collapseId) => {
  const root = removeNoise(cleanAttributes(parseHtml(html)));
  const target = root
    .querySelectorAll('div')
    .find((_, index) => `d${index.toString(36)}` === collapseId);

  if (!target) throw new Error(`Unknown collapse ID: ${collapseId}`);

  target.setAttribute('data-collapse-id', collapseId);
  return drop(pretty(target.toString(), { ocd: true, indent_size: 2 }).trim(), 2, 4);
};

export const slimHtml = ({ html, url }) => {
  const root = absoluteUrls(removeNoise(parseHtml(html)), url);

  const visit = (node) => {
    if (node.nodeType === 3) return node.rawText;
    if (node.nodeType === 8) return `<!--${node.rawText}-->`;

    const tagName = (node.tagName || '').toLowerCase();
    const attributes = Object.entries(node.attrs || {})
      .filter(
        ([key, value]) =>
          ['class', 'id'].includes(key) || (key.startsWith('data-') && value && value.length < 500)
      )
      .map(([key, value]) => ` ${key}="${String(value).slice(0, 400)}"`)
      .join('');
    const inner = (node.childNodes || []).map(visit).join('').trim();
    const href = (node.getAttribute?.('href') || '').slice(0, 1000);
    const src = (node.getAttribute?.('src') || '').slice(0, 1000);

    if (tagName === 'a' && href) return `<a href="${href}"${attributes}>${inner}</a>`;
    if (tagName === 'meta') return node.toString();
    if (['img', 'source', 'video', 'audio'].includes(tagName) && src && !src.startsWith('data:')) {
      return `<${tagName} src="${src}"${attributes}/>`;
    }
    if (tagName) return `<${tagName}${attributes}>${inner}</${tagName}>`;
    return inner;
  };

  return pretty(`<html>${visit(root)}</html>`, { ocd: true }).trim();
};
