'use strict';

const path = require('node:path').posix;
const { TextDecoder } = require('node:util');

const ENTRYPOINTS = ['template.html', 'template.txt', 'template.tpl', 'index.tpl.php', 'index.tpl.html', 'index.tpl', 'template.tpl.php'];
const SAFE_ENTRYPOINTS = ENTRYPOINTS.filter(name => !/\.tpl\.php$/i.test(name));
const LIMITS = { depth: 10, files: 100, bytes: 2 * 1024 * 1024, lines: 20000, directoryEntries: 200 };
const IGNORED_DIRECTORIES = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage']);
const SOURCE_EXTENSION = /\.(?:html|txt|tpl|tpl\.php)$/i;
const SAFE_SOURCE_EXTENSION = /\.(?:html|txt|tpl)$/i;

function key(uri) {
    return uri.toString();
}

function directory(uri) {
    return uri.with({ path: path.dirname(uri.path), query: '', fragment: '' });
}

function isWithin(root, uri) {
    return root.scheme === uri.scheme && root.authority === uri.authority
        && (uri.path === root.path || uri.path.startsWith(root.path.replace(/\/$/, '') + '/'));
}

function validPath(value, partial = false) {
    if (typeof value !== 'string' || (!partial && !value) || /^[\/]/.test(value)
        || /[\\\x00-\x1f\x7f]/.test(value) || /^[a-z][a-z\d+.-]*:/i.test(value)) {
        return false;
    }
    const parts = value.split('/');
    return parts.every((part, index) => (partial && index === parts.length - 1 && part === '')
        || (part !== '' && part !== '.' && part !== '..' && !part.startsWith('.')
            && !IGNORED_DIRECTORIES.has(part)));
}

/** Reads only an entrypoint and its explicitly included source files. No template is executed. */
class ProjectLoader {
    constructor(vscode, language) {
        this.vscode = vscode;
        this.language = language;
        this.decoder = new TextDecoder('utf-8', { fatal: true });
    }

    _cancelled(context) {
        return context.token?.isCancellationRequested === true;
    }

    _join(root, relative) {
        return this.vscode.Uri.joinPath(root, relative.replace(/\/$/, ''));
    }

    _dialect(document, configuration = this.vscode.workspace.getConfiguration('fastLandingsTemplates', document.uri)) {
        const value = configuration.get('dialect', this.language.DEFAULT_DIALECT || 'fast-landings-v1');
        return this.language.normalizeDialect ? this.language.normalizeDialect(value) : value;
    }

    _context(document, token, dialect = this.language.DEFAULT_DIALECT || 'fast-landings-v1') {
        const open = new Map();
        for (const item of this.vscode.workspace.textDocuments || []) {
            if (!item.isClosed) open.set(key(item.uri), item);
        }
        // The document passed by a provider can be newer than workspace.textDocuments.
        open.set(key(document.uri), document);
        return { token, dialect, open, sources: new Map(), parsed: new Map(), stats: new Map(), bytes: 0, lines: 0 };
    }

    async _stat(uri, context) {
        if (this._cancelled(context)) return undefined;
        const uriKey = key(uri);
        if (context.stats.has(uriKey)) return context.stats.get(uriKey);
        let stat;
        try {
            stat = await this.vscode.workspace.fs.stat(uri);
        } catch {
            // Includes can be unfinished, missing, or inaccessible while the author types.
        }
        context.stats.set(uriKey, stat);
        return stat;
    }

    async _safePath(root, uri, context, allowMissingLast = false) {
        if (!isWithin(root, uri) || this._cancelled(context)) return false;
        const relative = path.relative(root.path, uri.path);
        const segments = relative ? relative.split('/') : [];
        const symbolicLink = this.vscode.FileType?.SymbolicLink ?? 64;
        const directoryType = this.vscode.FileType?.Directory ?? 2;
        for (let index = 0; index <= segments.length; index++) {
            const segmentUri = index === 0 ? root : this._join(root, segments.slice(0, index).join('/'));
            const stat = await this._stat(segmentUri, context);
            if (this._cancelled(context)) return false;
            if (!stat) return allowMissingLast && index === segments.length;
            if (stat.type & symbolicLink) return false;
            if (index < segments.length && !(stat.type & directoryType)) return false;
        }
        return true;
    }

    async _source(uri, context, root, active = false) {
        if (this._cancelled(context)) return undefined;
        const uriKey = key(uri);
        const buffer = context.open.get(uriKey);
        // Check every path component even for open buffers and previously read sources.
        if (!active && !await this._safePath(root, uri, context, Boolean(buffer))) return undefined;
        if (context.sources.has(uriKey)) return context.sources.get(uriKey);
        if (context.sources.size >= LIMITS.files) return undefined;
        let text;
        try {
            if (buffer) {
                text = buffer.getText();
            } else {
                const stat = await this._stat(uri, context);
                const fileType = this.vscode.FileType?.File ?? 1;
                if (!stat || !(stat.type & fileType) || stat.size > LIMITS.bytes - context.bytes) return undefined;
                if (this._cancelled(context)) return undefined;
                const bytes = await this.vscode.workspace.fs.readFile(uri);
                if (bytes.byteLength > LIMITS.bytes - context.bytes) return undefined;
                text = this.decoder.decode(bytes);
            }
        } catch {
            return undefined;
        }
        if (this._cancelled(context)) return undefined;
        if (text.includes('\0')) return undefined;
        const size = Buffer.byteLength(text, 'utf8');
        if (size > LIMITS.bytes - context.bytes) return undefined;
        const lines = (text.match(/\r\n|\r|\n/g) || []).length + 1;
        if (lines > LIMITS.lines - context.lines) return undefined;
        context.bytes += size;
        context.lines += lines;
        const source = { uri, text };
        context.sources.set(uriKey, source);
        return source;
    }

    _parse(source, context) {
        const uriKey = key(source.uri);
        if (!context.parsed.has(uriKey)) {
            context.parsed.set(uriKey, this.language.parseDocument(uriKey, source.text, { dialect: context.dialect }));
        }
        return context.parsed.get(uriKey);
    }

    _entrypoints(context) {
        return context.dialect === 'safe-html-v1' ? SAFE_ENTRYPOINTS : ENTRYPOINTS;
    }

    _supportsSource(pathname, context) {
        return context.dialect !== 'safe-html-v1' || !/\.(?:php\d*|phtml|phar|blade(?:\.php)?|cgi|pl|py|rb|sh|asp|aspx|jsp)(?:\.|$)/i.test(pathname);
    }

    async _graph(entrypoint, root, context, active) {
        const documents = new Map();
        const includeTargets = new Map();
        const visit = async (uri, depth) => {
            if (this._cancelled(context) || depth > LIMITS.depth) return false;
            const uriKey = key(uri);
            if (documents.has(uriKey)) return true;
            const source = await this._source(uri, context, root, active && uriKey === key(active));
            if (!source) return false;
            documents.set(uriKey, source);
            const targets = [];
            includeTargets.set(uriKey, targets);
            const parsed = this._parse(source, context);
            for (const include of parsed.includes || []) {
                if (this._cancelled(context)) break;
                if (!validPath(include.path) || !this._supportsSource(include.path, context)) continue;
                // Includes are always relative to the package root, even from nested fragments.
                const target = this._join(root, include.path);
                if (await visit(target, depth + 1)) targets.push({ ...include, uri: target });
            }
            return true;
        };
        await visit(entrypoint, 0);
        return { documents, includeTargets, rootUri: root, entrypointUri: entrypoint };
    }

    async _selectGraph(document, context) {
        const activeUri = document.uri;
        const activeRoot = directory(activeUri);
        // Reserve the current buffer in the shared operation budget, including unsaved edits.
        await this._source(activeUri, context, activeRoot, true);
        const entrypoints = this._entrypoints(context);
        if (entrypoints.includes(path.basename(activeUri.path))) {
            return this._graph(activeUri, activeRoot, context, activeUri);
        }
        const workspaceRoot = this.vscode.workspace.getWorkspaceFolder(activeUri)?.uri;
        let candidateRoot = activeRoot;
        for (let level = 0; level < 32 && !this._cancelled(context); level++) {
            for (const name of entrypoints) {
                const candidate = this._join(candidateRoot, name);
                if (key(candidate) === key(activeUri)) continue;
                const graph = await this._graph(candidate, candidateRoot, context);
                if (graph.documents.has(key(activeUri))) return graph;
            }
            if (!workspaceRoot || key(candidateRoot) === key(workspaceRoot)) break;
            const parent = directory(candidateRoot);
            if (!isWithin(workspaceRoot, parent) || key(parent) === key(candidateRoot)) break;
            candidateRoot = parent;
        }
        // An unrelated neighboring template must not leak its symbols into this file.
        return this._graph(activeUri, activeRoot, context, activeUri);
    }

    async load(document, cancellationToken) {
        const configuration = this.vscode.workspace.getConfiguration('fastLandingsTemplates', document.uri);
        const dialect = this._dialect(document, configuration);
        const context = this._context(document, cancellationToken, dialect);
        const graph = await this._selectGraph(document, context);
        const configuredTypes = configuration.get('customTypes', []);
        const customTypes = Array.isArray(configuredTypes) ? configuredTypes : [];
        const sources = this._cancelled(context) ? [] : Array.from(graph.documents.values(), source => ({
            uri: key(source.uri), text: source.text,
        }));
        return { ...graph, dialect, project: this.language.buildProject(sources, { customTypes, dialect }) };
    }

    async completeIncludes(document, prefix, cancellationToken) {
        if (!validPath(prefix, true)) return [];
        const dialect = this._dialect(document);
        const context = this._context(document, cancellationToken, dialect);
        const graph = await this._selectGraph(document, context);
        if (this._cancelled(context)) return [];
        const slash = prefix.lastIndexOf('/');
        const parent = slash < 0 ? '' : prefix.slice(0, slash + 1);
        const partial = prefix.slice(slash + 1);
        const parentUri = parent ? this._join(graph.rootUri, parent) : graph.rootUri;
        if (!await this._safePath(graph.rootUri, parentUri, context)) return [];
        let entries;
        try {
            entries = await this.vscode.workspace.fs.readDirectory(parentUri);
        } catch {
            return [];
        }
        if (this._cancelled(context)) return [];
        const directoryType = this.vscode.FileType?.Directory ?? 2;
        const fileType = this.vscode.FileType?.File ?? 1;
        const symbolicLink = this.vscode.FileType?.SymbolicLink ?? 64;
        const sourceExtension = context.dialect === 'safe-html-v1' ? SAFE_SOURCE_EXTENSION : SOURCE_EXTENSION;
        // Include newly created, unsaved fragments as well as files already on disk.
        const byName = new Map(entries.slice(0, LIMITS.directoryEntries));
        for (const openDocument of context.open.values()) {
            if (key(directory(openDocument.uri)) === key(parentUri) && byName.size < LIMITS.directoryEntries) {
                const name = path.basename(openDocument.uri.path);
                if (!byName.has(name)) byName.set(name, fileType);
            }
        }
        return Array.from(byName)
            .filter(([name, type]) => validPath(name) && name.startsWith(partial) && !(type & symbolicLink)
                && ((type & directoryType) || ((type & fileType) && sourceExtension.test(name))))
            .map(([name, type]) => {
                const isDirectory = Boolean(type & directoryType);
                const insertText = parent + name + (isDirectory ? '/' : '');
                return { label: name + (isDirectory ? '/' : ''), insertText, isDirectory, detail: insertText };
            })
            .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.label.localeCompare(b.label));
    }
}

module.exports = { ProjectLoader, LIMITS };
