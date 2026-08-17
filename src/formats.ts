import { parse, HTMLElement, type Node } from 'node-html-parser';
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

const parseHtml = (html: string) => parse(html || '', { comment: true });

const removeNoise = (root: HTMLElement) => {
  root
    .querySelectorAll([...defaultRemoveTags, 'script'].join(', '))
    .forEach((node: HTMLElement) => node.remove());
  return root;
};

const cleanAttributes = (root: HTMLElement, attributes = defaultRemoveAttributes) => {
  const visit = (node: Node) => {
    if (!node?.childNodes) return;

    if (node instanceof HTMLElement) {
      for (const attribute of Object.keys(node.attributes || {})) {
        if (attributes.includes(attribute)) {
          node.removeAttribute(attribute);
        } else if ((node.attributes[attribute] || '').length > 400) {
          node.setAttribute(attribute, node.attributes[attribute].slice(0, 400));
        }
      }
    }

    node.childNodes.forEach(visit);
  };

  visit(root);
  return root;
};

const absoluteUrls = (root: HTMLElement, url?: string) => {
  if (!url) return root;

  const attrsToFix: Record<string, string> = {
    a: 'href',
    img: 'src',
    source: 'src',
    script: 'src',
  };
  const visit = (node: Node) => {
    const element = node as HTMLElement;
    const attribute = attrsToFix[(element.tagName || '').toLowerCase()];
    const value = attribute && element.getAttribute?.(attribute);

    if (value && !/^(?:[a-z]+:|#)/i.test(value)) {
      try {
        element.setAttribute(attribute, new URL(value, url).toString());
      } catch {
        // Leave malformed URLs unchanged.
      }
    }

    node.childNodes?.forEach(visit);
  };

  visit(root);
  return root;
};

export const remove = (
  html: string,
  tags = defaultRemoveTags,
  attributes = defaultRemoveAttributes
) => {
  const root = parseHtml(html);
  root.querySelectorAll(tags.join(', ')).forEach((node: HTMLElement) => node.remove());
  return cleanAttributes(root, attributes).toString();
};

export const drop = (html: string, levels = 2, limit = 16) => {
  const shape = (node: Node, depth: number): string => {
    if (depth === 0) return '';
    return `{${(node instanceof HTMLElement ? node.tagName : '.') || '.'}${(node.childNodes || [])
      .map((child: Node) => shape(child, depth - 1))
      .join('')}}`;
  };

  const prune = (parent: HTMLElement, children: Node[]) => {
    const edge = Math.floor(limit / 2);
    if (children.length <= edge * 2) return;

    let bytes = 0;
    const omitted = children.slice(edge, children.length - edge);
    for (const child of omitted) {
      bytes += Buffer.byteLength(child.toString(), 'utf8');
      parent.removeChild(child);
    }

    const anchor = children[children.length - edge];
    if (anchor instanceof HTMLElement) {
      anchor.before(
        parse(`<!-- dropped ${omitted.length} nodes of ${bytes} bytes for context reduction -->`, {
          comment: true,
        })
      );
    }
  };

  const visit = (node: Node) => {
    if (node instanceof HTMLElement) {
      const groups = new Map<string, Node[]>();
      for (const child of node.childNodes || []) {
        if (child.nodeType === 3) continue;
        const key = shape(child, levels);
        groups.set(key, [...(groups.get(key) || []), child]);
      }
      for (const children of groups.values()) prune(node, children);
    }
    node.childNodes?.forEach(visit);
  };

  const root = parseHtml(html);
  visit(root);
  return root
    .toString()
    .replaceAll(/^[ \t]+$/gm, '')
    .replaceAll(/\n+/g, '\n');
};

export const collapseHtml = (
  html: string,
  shouldExpand: string[] | Record<string, unknown> = []
) => {
  const previewText = (text: string, maxBytes = 500) => {
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
  const expansionIds = new Set(
    Array.isArray(shouldExpand) ? shouldExpand : Object.keys(shouldExpand)
  );
  const divs = root.querySelectorAll('div');
  const refs = new Map<HTMLElement, string>(
    divs.map((div, index) => [div, `d${index.toString(36)}`])
  );
  const open = new Set<HTMLElement>();

  for (const div of divs) {
    if (!expansionIds.has(refs.get(div)!)) continue;
    for (let node = div; node; node = node.parentNode) {
      if (refs.has(node)) open.add(node);
    }
  }

  const visible = divs.filter((div: HTMLElement) => {
    for (let node = div.parentNode; node; node = node.parentNode) {
      if (refs.has(node) && !open.has(node)) return false;
    }
    return true;
  });

  for (const div of visible) {
    const ref = refs.get(div);
    if (open.has(div)) {
      div.setAttribute('data-collapse-id', ref!);
      continue;
    }

    const summary = `[collapsed ${ref}; ${div.childElementCount} elements]`;
    const preview = previewText(div.text);
    div.setAttributes({ 'data-collapse-id': ref! });
    div.set_content('');
    div.append(preview ? `${summary} ${preview}` : summary);
  }

  return pretty(root.toString(), { ocd: true, indent_size: 2 }).trim();
};

export const inspect = (html: string, collapseId: string) => {
  const root = removeNoise(cleanAttributes(parseHtml(html)));
  const target = root
    .querySelectorAll('div')
    .find((_: HTMLElement, index: number) => `d${index.toString(36)}` === collapseId);

  if (!target) throw new Error(`Unknown collapse ID: ${collapseId}`);

  target.setAttribute('data-collapse-id', collapseId);
  return drop(pretty(target.toString(), { ocd: true, indent_size: 2 }).trim(), 2, 4);
};

export const slimHtml = ({ html, url }: { html: string; url?: string }) => {
  const root = absoluteUrls(removeNoise(parseHtml(html)), url);

  const visit = (node: Node): string => {
    if (node.nodeType === 3) return node.rawText;
    if (node.nodeType === 8) return `<!--${node.rawText}-->`;

    const element = node as HTMLElement;
    const tagName = (element.tagName || '').toLowerCase();
    const attributes = Object.entries(element.attrs || {})
      .filter(
        ([key, value]) =>
          ['class', 'id'].includes(key) || (key.startsWith('data-') && value && value.length < 500)
      )
      .map(([key, value]) => ` ${key}="${String(value).slice(0, 400)}"`)
      .join('');
    const inner = (node.childNodes || []).map(visit).join('').trim();
    const href = (element.getAttribute?.('href') || '').slice(0, 1000);
    const src = (element.getAttribute?.('src') || '').slice(0, 1000);

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
