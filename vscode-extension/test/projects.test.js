'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path').posix;
const { ProjectLoader, LIMITS } = require('../src/projects');
const language = require('../src/language');

class Uri {
    constructor(value, scheme = 'file', authority = '') {
        this.path = value;
        this.scheme = scheme;
        this.authority = authority;
    }
    toString() { return `${this.scheme}://${this.authority}${this.path}`; }
    with(change) { return new Uri(change.path ?? this.path, this.scheme, this.authority); }
    static joinPath(base, ...parts) { return base.with({ path: path.join(base.path, ...parts) }); }
}

function document(name, text) {
    return { uri: new Uri(name), getText: () => text, isClosed: false };
}

function fixture(files = {}, buffers = [], options = {}) {
    const entries = new Map();
    const reads = [];
    const stats = [];
    const directoryReads = [];
    const set = (name, content, type = 1) => {
        entries.set(name, { type, content });
        let parent = path.dirname(name);
        while (!entries.has(parent)) {
            entries.set(parent, { type: 2 });
            if (parent === '/') break;
            parent = path.dirname(parent);
        }
    };
    for (const [name, content] of Object.entries(files)) set(name, content);
    for (const buffer of buffers) {
        const parent = path.dirname(buffer.uri.path);
        if (!entries.has(parent)) set(parent, undefined, 2);
    }
    const vscode = {
        Uri,
        FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
        workspace: {
            textDocuments: buffers,
            getWorkspaceFolder(uri) {
                const root = options.workspaceRoot === undefined ? '/work' : options.workspaceRoot;
                return root && (uri.path === root || uri.path.startsWith(root + '/')) ? { uri: new Uri(root) } : undefined;
            },
            getConfiguration(namespace) {
                assert.equal(namespace, 'fastLandingsTemplates');
                return { get: (name, fallback) => options[name] ?? fallback };
            },
            fs: {
                async stat(uri) {
                    stats.push(uri.path);
                    const entry = entries.get(uri.path);
                    if (!entry) throw new Error('ENOENT');
                    return { type: entry.type, size: entry.content ? Buffer.byteLength(entry.content) : 0 };
                },
                async readFile(uri) {
                    reads.push(uri.path);
                    options.onRead?.(uri);
                    const entry = entries.get(uri.path);
                    if (!entry || !(entry.type & 1)) throw new Error('ENOENT');
                    return Buffer.from(entry.content);
                },
                async readDirectory(uri) {
                    directoryReads.push(uri.path);
                    return Array.from(entries).filter(([name]) => name !== uri.path && path.dirname(name) === uri.path)
                        .map(([name, entry]) => [path.basename(name), entry.type]);
                },
            },
        },
    };
    return { loader: new ProjectLoader(vscode, language), vscode, entries, set, reads, stats, directoryReads };
}

function sourceTexts(result) {
    return Array.from(result.documents.values(), source => source.text);
}

test('loads root-relative nested includes and preserves precise include definition spans', async () => {
    const main = document('/work/article/template.html', '@include "blocks/comment.tpl"\n@layout\n@endlayout');
    const files = {
        '/work/article/blocks/comment.tpl': '@include "types/comment.tpl"\n@block comment(item: Comment)\n@endblock',
        '/work/article/types/comment.tpl': '@type Comment\n@param author String\n@endtype',
        '/work/article/blocks/types/comment.tpl': '@type Incorrect\n@endtype',
    };
    const { loader, reads } = fixture(files, [main]);
    const result = await loader.load(main);
    assert.equal(result.documents.size, 3);
    assert.equal(result.rootUri.path, '/work/article');
    assert.equal(result.entrypointUri.path, main.uri.path);
    assert.deepEqual(reads, ['/work/article/blocks/comment.tpl', '/work/article/types/comment.tpl']);
    const target = result.includeTargets.get(main.uri.toString())[0];
    assert.equal(main.getText().slice(target.start, target.end), 'blocks/comment.tpl');
    assert.equal(target.uri.path, '/work/article/blocks/comment.tpl');
});

test('finds an ancestor entrypoint only when its graph includes the active fragment', async () => {
    const active = document('/work/article/blocks/comment.tpl', '@block comment(item: Comment)\n@endblock');
    const { loader } = fixture({
        '/work/article/template.html': '@include "blocks/comment.tpl"\n@include "types/comment.tpl"',
        '/work/article/types/comment.tpl': '@type Comment\n@param author String\n@endtype',
        '/work/article/blocks/template.html': '@param unrelated String',
    }, [active]);
    const result = await loader.load(active);
    assert.equal(result.entrypointUri.path, '/work/article/template.html');
    assert.equal(result.rootUri.path, '/work/article');
    assert.equal(result.documents.size, 3);
    assert.ok(sourceTexts(result).some(text => text.includes('@type Comment')));
    assert.ok(sourceTexts(result).every(text => !text.includes('unrelated')));
    assert.ok(result.project.types.has('Comment'));
    assert.ok(result.project.blocks.has('comment'));
});

test('does not leak declarations from unrelated templates and honors single-file roots', async () => {
    const active = document('/work/article/standalone.tpl', '@param own String\n@include "own.tpl"');
    const { loader } = fixture({
        '/work/template.html': '@param outer String',
        '/work/article/template.html': '@param unrelated String',
        '/work/article/own.tpl': '@param child String',
        '/work/other/template.html': '@param other String',
    }, [active]);
    const result = await loader.load(active);
    assert.equal(result.entrypointUri.path, active.uri.path);
    assert.equal(result.rootUri.path, '/work/article');
    assert.deepEqual(sourceTexts(result), [active.getText(), '@param child String']);
});

test('prefers dirty buffers including an unsaved entrypoint and newly created fragments', async () => {
    const active = document('/work/article/blocks/comment.tpl', '@param current String');
    const main = document('/work/article/template.tpl', '@include "blocks/comment.tpl"\n@include "draft.tpl"');
    const draft = document('/work/article/draft.tpl', '@type Draft\n@param value Text\n@endtype');
    const { loader, reads } = fixture({ '/work/article/blocks/comment.tpl': '@param stale String' }, [main, draft, active]);
    const result = await loader.load(active);
    assert.equal(result.entrypointUri.path, main.uri.path);
    assert.equal(result.documents.size, 3);
    assert.ok(sourceTexts(result).includes(active.getText()));
    assert.ok(sourceTexts(result).includes(draft.getText()));
    assert.ok(sourceTexts(result).every(text => !text.includes('stale')));
    assert.deepEqual(reads, []);
});

test('checks all canonical names in the nearest directory and stays inside workspace boundaries', async () => {
    const active = document('/work/article/piece.tpl', '@param value String');
    const { loader, stats } = fixture({
        '/work/article/template.html': '@param unrelated String',
        '/work/article/template.txt': '@include "piece.tpl"',
        '/template.html': '@include "work/article/piece.tpl"',
    }, [active]);
    assert.equal((await loader.load(active)).entrypointUri.path, '/work/article/template.txt');
    assert.ok(!stats.includes('/template.html'));
});

test('without a workspace ancestor discovery stops at the current folder', async () => {
    const active = document('/outside/nested/piece.tpl', '@param own String');
    const { loader, stats } = fixture({ '/outside/template.html': '@include "nested/piece.tpl"' }, [active], { workspaceRoot: null });
    const result = await loader.load(active);
    assert.equal(result.entrypointUri.path, active.uri.path);
    assert.ok(!stats.includes('/outside/template.html'));
});

test('handles cycles, missing includes, malformed UTF-8, and NUL bytes without failing', async () => {
    const main = document('/work/template.html', '@include "cycle.tpl"\n@include "missing.tpl"\n@include "invalid.tpl"\n@include "nul.tpl"');
    const { loader } = fixture({
        '/work/cycle.tpl': '@include "template.html"\n@param valid String',
        '/work/invalid.tpl': Buffer.from([0xc3, 0x28]),
        '/work/nul.tpl': '@param invalid String\0',
    }, [main]);
    const result = await loader.load(main);
    assert.equal(result.documents.size, 2);
    assert.equal(result.includeTargets.get(main.uri.toString()).length, 1);
});

test('rejects traversal, absolute paths, schemes, backslashes, and symlink paths before reading', async () => {
    const main = document('/work/template.html', [
        '@include "../secret.tpl"', '@include "/secret.tpl"', '@include "file:///secret.tpl"',
        '@include "blocks\\secret.tpl"',
        '@include "C:/secret.tpl"', '@include "linked/secret.tpl"', '@include "link.tpl"',
        '@include "vendor/secret.tpl"', '@include ".hidden.tpl"', '@include "ok.tpl"',
    ].join('\n'));
    const { loader, set, reads } = fixture({ '/work/ok.tpl': '@param safe String' }, [main]);
    set('/work/link.tpl', '@param unsafe String', 1 | 64);
    set('/work/linked/secret.tpl', '@param unsafe String');
    set('/work/linked', undefined, 2 | 64);
    const result = await loader.load(main);
    assert.equal(result.documents.size, 2);
    assert.deepEqual(reads, ['/work/ok.tpl']);
    for (const prefix of ['../', '/', 'file://', 'C:/', 'blocks\\', 'x\0']) {
        assert.deepEqual(await loader.completeIncludes(main, prefix), []);
    }
});

test('does not trust a dirty included buffer reached through a symlink directory', async () => {
    const main = document('/work/template.html', '@include "linked/secret.tpl"');
    const linked = document('/work/linked/secret.tpl', '@param secret String');
    const { loader, set } = fixture({}, [main, linked]);
    set('/work/linked', undefined, 2 | 64);
    assert.equal((await loader.load(main)).documents.size, 1);
});

test('stops include traversal at the depth and file budgets', async () => {
    const main = document('/work/template.html', '@include "piece0.tpl"');
    const files = {};
    for (let i = 0; i < 15; i++) files[`/work/piece${i}.tpl`] = `@include "piece${i + 1}.tpl"`;
    const { loader } = fixture(files, [main]);
    assert.equal((await loader.load(main)).documents.size, LIMITS.depth + 1);
    const many = document('/work/template.html', Array.from({ length: 110 }, (_, i) => `@include "p${i}.tpl"`).join('\n'));
    const manyFiles = Object.fromEntries(Array.from({ length: 110 }, (_, i) => [`/work/p${i}.tpl`, `@param p${i} String`]));
    const result = await fixture(manyFiles, [many]).loader.load(many);
    assert.equal(result.documents.size, LIMITS.files);
});

test('bounds aggregate bytes and lines before parsing included files', async () => {
    const main = document('/work/template.html', '@include "huge.tpl"\n@include "lines.tpl"\n@include "good.tpl"');
    const { loader, reads } = fixture({
        '/work/huge.tpl': 'a'.repeat(LIMITS.bytes),
        '/work/lines.tpl': '\r'.repeat(LIMITS.lines),
        '/work/good.tpl': '@param valid String',
    }, [main]);
    const result = await loader.load(main);
    assert.equal(result.documents.size, 2);
    assert.ok(!reads.includes('/work/huge.tpl'));
});

test('honors cancellation before and during filesystem reads', async () => {
    const main = document('/work/template.html', '@include "piece.tpl"\n@include "other.tpl"');
    const cancelled = { isCancellationRequested: true };
    const first = fixture({}, [main]);
    assert.equal((await first.loader.load(main, cancelled)).documents.size, 0);
    assert.deepEqual(first.stats, []);
    assert.deepEqual(await first.loader.completeIncludes(main, '', cancelled), []);
    const token = { isCancellationRequested: false };
    const second = fixture({ '/work/piece.tpl': '@param piece String', '/work/other.tpl': '@param other String' }, [main], {
        onRead: () => { token.isCancellationRequested = true; },
    });
    const result = await second.loader.load(main, token);
    assert.deepEqual(second.reads, ['/work/piece.tpl']);
    assert.equal(result.documents.size, 1);
});

test('completes package-root include paths with directories, sources, and unsaved files only', async () => {
    const active = document('/work/article/blocks/comment.tpl', '@param comment String');
    const draft = document('/work/article/blocks/draft.tpl', '@param draft String');
    const { loader, set, directoryReads } = fixture({
        '/work/article/template.html': '@include "blocks/comment.tpl"',
        '/work/article/blocks/comment.tpl': active.getText(),
        '/work/article/blocks/article.txt': '',
        '/work/article/blocks/image.png': '',
        '/work/article/blocks/.secret.tpl': '',
        '/work/article/blocks/nested/piece.html': '',
        '/work/article/blocks/node_modules/package.tpl': '',
    }, [active, draft]);
    set('/work/article/blocks/link.tpl', '', 1 | 64);
    const completions = await loader.completeIncludes(active, 'blocks/');
    assert.deepEqual(completions.map(item => item.insertText), ['blocks/nested/', 'blocks/article.txt', 'blocks/comment.tpl', 'blocks/draft.tpl']);
    assert.deepEqual(directoryReads, ['/work/article/blocks']);
    assert.equal((await loader.completeIncludes(active, 'blocks/dr'))[0].insertText, 'blocks/draft.tpl');
});

test('limits directory completion enumeration', async () => {
    const main = document('/work/template.html', '@layout\n@endlayout');
    const files = Object.fromEntries(Array.from({ length: 240 }, (_, i) => [`/work/p${i}.tpl`, '']));
    const { loader } = fixture(files, [main]);
    assert.equal((await loader.completeIncludes(main, '')).length, LIMITS.directoryEntries);
});

test('reloads changed include graphs and forwards configured author types', async () => {
    let text = '@include "first.tpl"';
    const main = { uri: new Uri('/work/template.html'), getText: () => text };
    const { loader } = fixture({ '/work/first.tpl': '@param first String', '/work/second.tpl': '@param second String' }, [main], {
        customTypes: ['Headline'],
    });
    assert.ok(sourceTexts(await loader.load(main)).includes('@param first String'));
    text = '@include "second.tpl"\n@param title Headline';
    const result = await loader.load(main);
    assert.ok(sourceTexts(result).includes('@param second String'));
    assert.ok(!sourceTexts(result).includes('@param first String'));
    assert.ok(result.project.customTypes.has('Headline'));
});

test('discovers tpl.php entrypoints and includes without importing companion page validations', async () => {
    const page = document('/work/form/index.tpl.php', '@include "rules.tpl.php"\n@layout\n<p>{query.subid}</p>\n@endlayout');
    const files = {
        '/work/form/rules.tpl.php': '@validation query fallback="/error"\n@param subid String required\n@endvalidation',
        '/work/form/success.tpl.php': '@validation body fallback="/error"\n@param name String required\n@endvalidation',
    };
    const { loader } = fixture(files, [page]);
    const result = await loader.load(page);
    assert.equal(result.entrypointUri.path, page.uri.path);
    assert.deepEqual(language.getRuntimeMacros(result.project, page.uri.toString()).map(item => item.name), ['query.subid']);
    assert.equal(result.project.params.size, 0);
    const includes = await loader.completeIncludes(page, '');
    assert.ok(includes.some(item => item.label === 'rules.tpl.php'));
});

test('safe-html-v1 keeps executable sources out of the graph and include completion', async () => {
    const page = document('/work/form/template.html', '@include "content.tpl"\n@include "rules.tpl.php"\n<p>{locale}</p>');
    const files = {
        '/work/form/content.tpl': '@param title String',
        '/work/form/rules.tpl.php': '@validation query fallback="/error"\n@param id String\n@endvalidation',
    };
    const { loader } = fixture(files, [page], { dialect: 'safe-html-v1' });
    const result = await loader.load(page);
    assert.equal(result.dialect, 'safe-html-v1');
    assert.equal(result.project.dialect, 'safe-html-v1');
    assert.deepEqual(sourceTexts(result), [page.getText(), '@param title String']);
    assert.equal(result.project.documents.get(page.uri.toString()).diagnostics.length, 0);
    const includes = await loader.completeIncludes(page, '');
    assert.ok(includes.some(item => item.label === 'content.tpl'));
    assert.ok(!includes.some(item => item.label === 'rules.tpl.php'));
});

test('safe-html-v1 does not discover a tpl.php entrypoint for a plain fragment', async () => {
    const active = document('/work/form/shared.tpl', '<p>{query.name}</p>');
    const { loader } = fixture({
        '/work/form/index.tpl.php': '@include "shared.tpl"\n@validation query fallback="/error"\n@param name String\n@endvalidation',
    }, [active], { dialect: 'safe-html-v1' });
    const result = await loader.load(active);
    assert.equal(result.entrypointUri.path, active.uri.path);
    assert.deepEqual(sourceTexts(result), [active.getText()]);
});
