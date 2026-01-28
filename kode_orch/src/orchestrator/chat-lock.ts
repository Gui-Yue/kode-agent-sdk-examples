/**
 * Async mutex for serializing access to Orchestrator's chatStream.
 * Both user messages (handleChat) and injection queue use this lock.
 */
export class ChatLock {
  private locked = false;
  private waiters: (() => void)[] = [];

  async acquire(): Promise<void> {
    while (this.locked) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    this.locked = true;
  }

  release(): void {
    this.locked = false;
    const next = this.waiters.shift();
    if (next) next();
  }

  get isLocked(): boolean {
    return this.locked;
  }
}
