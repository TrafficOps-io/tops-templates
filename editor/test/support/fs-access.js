const encoder = new TextEncoder();

function domError(name, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

export class MemoryFileHandle {
  kind = 'file';
  constructor(name, value = new Uint8Array()) { this.name = name; this.value = value; this.modified = Date.now(); }
  async getFile() {
    const value = this.value.slice(), modified = this.modified;
    return { size: value.byteLength, lastModified: modified, arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength), text: async () => new TextDecoder().decode(value) };
  }
  async createWritable() {
    return { write: async value => { this.value = value instanceof Uint8Array ? value.slice() : encoder.encode(value); }, close: async () => { this.modified = Date.now(); } };
  }
}

export class MemoryDirectoryHandle {
  kind = 'directory';
  constructor(name, entries = {}) {
    this.name = name;
    this.entries = new Map(Object.entries(entries).map(([entryName, value]) => [entryName, value instanceof MemoryDirectoryHandle || value instanceof MemoryFileHandle ? value : new MemoryFileHandle(entryName, typeof value === 'string' ? encoder.encode(value) : value)]));
  }
  async *values() { yield* this.entries.values(); }
  async getDirectoryHandle(name, { create = false } = {}) {
    const entry = this.entries.get(name);
    if (entry?.kind === 'directory') return entry;
    if (entry) throw domError('TypeMismatchError');
    if (!create) throw domError('NotFoundError');
    const directory = new MemoryDirectoryHandle(name);
    this.entries.set(name, directory);
    return directory;
  }
  async getFileHandle(name, { create = false } = {}) {
    const entry = this.entries.get(name);
    if (entry?.kind === 'file') return entry;
    if (entry) throw domError('TypeMismatchError');
    if (!create) throw domError('NotFoundError');
    const file = new MemoryFileHandle(name);
    this.entries.set(name, file);
    return file;
  }
  async removeEntry(name) {
    const entry = this.entries.get(name);
    if (!entry) throw domError('NotFoundError');
    if (entry.kind === 'directory' && entry.entries.size) throw domError('InvalidModificationError');
    this.entries.delete(name);
  }
}

