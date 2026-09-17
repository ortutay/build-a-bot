import type { Frame, Page } from 'playwright';

// Paths are relative to the current frame tree; enumerate again after navigation.
export const frameAt = (page: Page, path: number[] = []): Frame => {
  let frame = page.mainFrame();
  for (const index of path) {
    const child = frame.childFrames()[index];
    if (!child) {
      throw new Error(`Frame path no longer exists: ${path.join('.')}`);
    }
    frame = child;
  }
  return frame;
};

export const frameTree = (page: Page) => {
  const frames: Array<{ path: number[]; url: string; name: string }> = [];
  const visit = (frame: Frame, path: number[]) => {
    frames.push({ path, url: frame.url(), name: frame.name() });
    frame.childFrames().forEach((child, index) => visit(child, [...path, index]));
  };
  visit(page.mainFrame(), []);
  return frames;
};

// Serializable browser function. Clone the composed tree without changing the live page.
export const composedHtml = () => {
  const clone = (node: Node): Node => {
    if (node instanceof HTMLSlotElement) {
      const slot = document.createElement('span');
      slot.setAttribute('data-slot', node.name);
      const assigned = node.assignedNodes({ flatten: true });
      for (const child of assigned.length ? assigned : node.childNodes) {
        slot.appendChild(clone(child));
      }
      return slot;
    }
    const copy = node.cloneNode(false);
    const root = node instanceof Element ? node.shadowRoot : null;
    if (root && copy instanceof Element) {
      copy.setAttribute('data-shadow-root', 'open');
    }
    for (const child of root?.childNodes ?? node.childNodes) {
      copy.appendChild(clone(child));
    }
    return copy;
  };
  return '<!DOCTYPE html>\n' + (clone(document.documentElement) as Element).outerHTML;
};
