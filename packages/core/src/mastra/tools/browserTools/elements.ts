import type { Frame } from 'playwright';
import { z } from 'zod';

export const inspectOptionsSchema = z.object({
  selector: z.string().min(1).max(4096),
  limit: z.number().int().min(1).max(100).default(20),
  properties: z
    .array(z.string().min(1).max(128))
    .max(20)
    .default([])
    .describe(
      'Direct property names, not expressions or paths. Only primitive values are returned.'
    ),
});

const propertySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    truncated: z.boolean(),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['missing', 'unsupported-type', 'read-failed']),
  }),
]);

export const observationSchema = z.object({
  index: z.number().int().nonnegative(),
  tag: z.string(),
  attributes: z.record(z.string(), z.string()),
  text: z.string(),
  outerHTML: z.string(),
  visible: z.boolean(),
  properties: z.record(z.string(), propertySchema),
  truncated: z.array(z.string()),
});

export const inspectResultSchema = z.object({
  matched: z.number().int().nonnegative(),
  elements: z.array(observationSchema),
  truncated: z.boolean(),
});

export type PropertyResult = z.infer<typeof propertySchema>;
export type ElementObservation = z.infer<typeof observationSchema>;
export type InspectElementsResult = z.infer<typeof inspectResultSchema>;

// Serialized JSON characters, excluding the tool instrumentation envelope.
export const inspectionMaxChars = 128 * 1024;

// Self-contained: Playwright serializes this function into the browser context.
const readElement = (element: Element, names: string[]) => {
  const truncated: string[] = [];
  const clip = (val: string, path: string, max: number): string => {
    if (val.length > max) {
      truncated.push(path);
      return val.slice(0, max);
    }
    return val;
  };
  const attributes: Record<string, string> = Object.create(null);
  for (const attr of Array.from(element.attributes).slice(0, 32)) {
    if (attr.name.length > 128) {
      truncated.push('attributes');
      continue;
    }
    attributes[attr.name] = clip(attr.value, `attributes.${attr.name}`, 256);
  }
  if (element.attributes.length > 32) {
    truncated.push('attributes');
  }
  const properties: Record<string, PropertyResult> = Object.create(null);
  for (const name of names) {
    try {
      if (!(name in element)) {
        properties[name] = { status: 'unavailable', reason: 'missing' };
        continue;
      }
      const val: unknown = Reflect.get(element, name);
      if (
        val === null ||
        typeof val === 'string' ||
        typeof val === 'boolean' ||
        (typeof val === 'number' && Number.isFinite(val))
      ) {
        properties[name] = {
          status: 'ok',
          value: typeof val === 'string' ? clip(val, `properties.${name}`, 1024) : val,
          truncated: typeof val === 'string' && val.length > 1024,
        };
      } else {
        properties[name] = { status: 'unavailable', reason: 'unsupported-type' };
      }
    } catch (e) {
      properties[name] = { status: 'unavailable', reason: 'read-failed' };
    }
  }
  return {
    tag: clip(element.localName, 'tag', 128),
    attributes,
    text: clip(element.textContent ?? '', 'text', 4096),
    outerHTML: clip(element.outerHTML, 'outerHTML', 8192),
    properties,
    truncated,
  };
};

export const inspectElements = async (
  frame: Frame,
  input: z.input<typeof inspectOptionsSchema>
): Promise<InspectElementsResult> => {
  const { selector, limit, properties } = inspectOptionsSchema.parse(input);
  const locator = frame.locator(selector);
  const matched = await locator.count();
  const result: InspectElementsResult = { matched, elements: [], truncated: false };
  let size = JSON.stringify(result).length;
  for (let index = 0; index < Math.min(matched, limit); index++) {
    const element = await locator.nth(index).elementHandle({ timeout: 5000 });
    if (!element) {
      throw new Error('Element disappeared during inspection');
    }
    try {
      const snapshot = await element.evaluate(readElement, [...new Set(properties)]);
      const observation = { index, ...snapshot, visible: await element.isVisible() };
      const length = JSON.stringify(observation).length + 1;
      if (size + length > inspectionMaxChars) {
        break;
      }
      result.elements.push(observation);
      size += length;
    } finally {
      await element.dispose();
    }
  }
  result.truncated =
    result.elements.length < matched ||
    result.elements.some((element) => element.truncated.length > 0);
  return result;
};
