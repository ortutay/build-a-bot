import { describe, expect, it } from 'vitest';
import { KeyedSerialQueue } from '../../src/internal/util/KeyedSerialQueue.js';

describe('KeyedSerialQueue', () => {
  it('runs operations for one key in submission order', async () => {
    const queue = new KeyedSerialQueue<string>();
    const events: string[] = [];

    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let firstStarted!: () => void;
    const firstStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const first = queue.add('page-1', async () => {
      events.push('first-start');
      firstStarted();
      await firstRelease;
      events.push('first-end');
      return 'first';
    });

    await firstStart;

    const second = queue.add('page-1', async () => {
      events.push('second');
      return 'second';
    });

    expect(events).toEqual(['first-start']);

    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first-start', 'first-end', 'second']);
  });

  it('does not block operations for different keys', async () => {
    const queue = new KeyedSerialQueue<string>();

    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let firstStarted!: () => void;
    const firstStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const first = queue.add('page-1', async () => {
      firstStarted();
      await firstRelease;
      return 'first';
    });

    await firstStart;

    await expect(queue.add('page-2', async () => 'second')).resolves.toBe('second');

    releaseFirst();
    await expect(first).resolves.toBe('first');
  });
});
