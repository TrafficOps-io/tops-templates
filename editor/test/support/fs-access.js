const encoder = new TextEncoder();

function domError(name, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

const bytesOf = async value => {
  if (value && typeof value === 'object' && value.type === 'write' && 'data' in value) value = value.data;
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (typeof value?.arrayBuffer === 'function') return new Uint8Array(await value.arrayBuffer());
  return encoder.encode(String(value));
};

class MemoryHandle {
  permission = 'granted';
  async isSameEntry(other) { return this === other; }
  async queryPermission() { return this.permission; }
  async requestPermission() { return this.permission; }
}

export class MemoryFileHandle extends MemoryHandle {
  kind = 'file';
  constructor(name, value = new Uint8Array(), options = {}) { super(); this.name = name; this.value = value; this.now = options.now || Date.now; this.modified = this.now(); }
  async getFile() {
    const value = this.value.slice(), modified = this.modified;
    return { size: value.byteLength, lastModified: modified, arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength), text: async () => new TextDecoder().decode(value) };
  }
  // Buffered like browsers: content changes only on close(); abort() discards.
  async createWritable() {
    const chunks = []; let finished = false;
    const open = () => { if (finished) throw domError('InvalidStateError', 'Writable is closed'); };
    return {
      write: async value => { open(); chunks.push(await bytesOf(value)); },
      close: async () => {
        open(); finished = true;
        const joined = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
        let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
        this.value = joined; this.modified = this.now();
      },
      abort: async () => { finished = true; chunks.length = 0; },
    };
  }
}

export class MemoryDirectoryHandle extends MemoryHandle {
  kind = 'directory';
  constructor(name, initial = {}, options = {}) {
    super();
    this.name = name;
    this.now = options.now || Date.now;
    this.children = new Map(Object.entries(initial).map(([entryName, value]) => [entryName, value instanceof MemoryDirectoryHandle || value instanceof MemoryFileHandle ? value : new MemoryFileHandle(entryName, typeof value === 'string' ? encoder.encode(value) : value, { now: this.now })]));
  }
  async *keys() { yield* this.children.keys(); }
  async *entries() { yield* this.children.entries(); }
  async *values() { yield* this.children.values(); }
  async getDirectoryHandle(name, { create = false } = {}) {
    const entry = this.children.get(name);
    if (entry?.kind === 'directory') return entry;
    if (entry) throw domError('TypeMismatchError');
    if (!create) throw domError('NotFoundError');
    const directory = new MemoryDirectoryHandle(name, {}, { now: this.now });
    this.children.set(name, directory);
    return directory;
  }
  async getFileHandle(name, { create = false } = {}) {
    const entry = this.children.get(name);
    if (entry?.kind === 'file') return entry;
    if (entry) throw domError('TypeMismatchError');
    if (!create) throw domError('NotFoundError');
    const file = new MemoryFileHandle(name, new Uint8Array(), { now: this.now });
    this.children.set(name, file);
    return file;
  }
  async removeEntry(name, { recursive = false } = {}) {
    const entry = this.children.get(name);
    if (!entry) throw domError('NotFoundError');
    if (entry.kind === 'directory' && entry.children.size && !recursive) throw domError('InvalidModificationError');
    this.children.delete(name);
  }
}

