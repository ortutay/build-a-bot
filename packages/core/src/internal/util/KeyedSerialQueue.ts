import PQueue from 'p-queue';

export class KeyedSerialQueue<Key> {
  private readonly queues = new Map<Key, PQueue>();

  add<Value>(key: Key, task: () => Promise<Value>): Promise<Value> {
    let queue = this.queues.get(key);

    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      this.queues.set(key, queue);
    }

    const result = queue.add(task);

    void queue.onIdle().then(() => {
      if (this.queues.get(key) === queue) {
        this.queues.delete(key);
      }
    });

    return result;
  }
}
