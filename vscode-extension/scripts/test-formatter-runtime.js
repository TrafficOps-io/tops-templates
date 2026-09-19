'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { formatDocument } = require('@trafficops/template-language/formatter');

const packageRoot = path.resolve(__dirname, '..');
const applicationRoot = path.resolve(packageRoot, '..');
const fixtureRoot = path.join(packageRoot, 'test/fixtures/formatter');
const php = process.env.PHP_BINARY || 'php';

// PHP's DOM implementation avoids another npm dependency and inspects actual
// rendered HTML, after DSL directives and interpolations have been evaluated.
const inspectDom = String.raw`
if (!class_exists('DOMDocument')) {
    fwrite(STDERR, "The PHP DOM extension is required for formatter runtime tests.\n");
    exit(1);
}
libxml_use_internal_errors(true);
$document = new DOMDocument();
$document->loadHTML(stream_get_contents(STDIN));
$xpath = new DOMXPath($document);
$elements = [];
foreach ($xpath->query('//*') as $element) {
    $attributes = [];
    foreach ($element->attributes as $attribute) {
        $attributes[$attribute->name] = $attribute->value;
    }
    ksort($attributes);
    $elements[] = ['tag' => $element->tagName, 'attributes' => $attributes];
}
$protected = [];
foreach ($xpath->query('//*[@data-preserve]') as $element) {
    $protected[$element->getAttribute('data-preserve')] = $element->textContent;
}
$preline = [];
foreach ($xpath->query('//*[contains(concat(" ", normalize-space(@class), " "), " article-body ") or contains(concat(" ", normalize-space(@class), " "), " comment-body ")]') as $element) {
    $preline[] = $element->textContent;
}
$scripts = [];
foreach ($xpath->query('//script[not(@src)]') as $element) {
    $scripts[] = $element->textContent;
}
$styles = [];
foreach ($xpath->query('//style') as $element) {
    $styles[] = $element->textContent;
}
echo json_encode(compact('elements', 'protected', 'preline', 'scripts', 'styles'), JSON_THROW_ON_ERROR);
`;

function phpJson(args, input) {
  try {
    return JSON.parse(execFileSync(php, args, {
      encoding: 'utf8',
      input,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('PHP is required for formatter runtime tests. Install PHP or set PHP_BINARY to its executable.', { cause: error });
    }
    throw new Error(`PHP runtime verification failed: ${error.stderr || error.message}`, { cause: error });
  }
}

function render(file) {
  return phpJson([path.join(fixtureRoot, 'render.php'), file]);
}

function inspect(html) {
  return phpJson(['-r', inspectDom], html);
}

function visibleText(text) {
  return text.replace(/[\t\n\f\r ]+/g, ' ').trim();
}

function executeFixtureScript(scripts) {
  assert.equal(scripts.length, 1, 'The controlled fixture should have exactly one inline script');
  // Only execute our checked-in test fixture, never the public sample or user files.
  const result = vm.runInNewContext(`${scripts[0]}\nJSON.stringify(globalThis.formatterResult)`, Object.create(null), { timeout: 1000 });
  return JSON.parse(result);
}

function fixtureCssDeclarations(styles) {
  // The controlled fixture has simple rules without strings or nested values;
  // comparing resolved declarations catches lost/replaced CSS interpolations.
  return [...styles.join('\n').matchAll(/(--[\w-]+|[a-z][\w-]*)\s*:\s*([^;{}]+?)\s*(?:;|(?=}))/g)]
    .map(([, property, value]) => [property, value.replace(/\s+/g, ' ').trim()]);
}

async function verifyFile(sourceFile, temporary, fixture) {
  const source = await fs.readFile(sourceFile, 'utf8');
  const options = { tabSize: 2, insertSpaces: true, printWidth: 80 };
  const formatted = await formatDocument(source, options);
  assert.equal(typeof formatted, 'string', 'The formatter must return document text');
  assert.notEqual(formatted, source, `${path.basename(sourceFile)} should actually be formatted`);
  assert.equal(await formatDocument(formatted, options), formatted, 'Formatting must be idempotent');
  const formattedFile = path.join(temporary, path.basename(sourceFile));
  await fs.writeFile(formattedFile, formatted);
  const before = render(sourceFile);
  const after = render(formattedFile);
  assert.deepEqual(after.schema, before.schema, 'Formatting changed the backend form schema');
  assert.deepEqual(after.defaults, before.defaults, 'Formatting changed default values');

  const beforeDom = inspect(before.html);
  const afterDom = inspect(after.html);
  assert.deepEqual(afterDom.elements, beforeDom.elements, 'Formatting changed rendered elements or attributes');
  assert.deepEqual(afterDom.preline, beforeDom.preline, 'Formatting changed article/comment text rendered with white-space: pre-line');

  if (fixture) {
    assert.match(formatted, /^ {2}@param name String/m, 'Fields inside @type need indentation');
    assert.match(formatted, /^\s*@@literal Keep this escaped at sign\.$/m, 'Literal @ escape was changed');
    assert.deepEqual(Object.keys(afterDom.protected), Object.keys(beforeDom.protected));
    for (const name of ['pre', 'textarea']) {
      assert.equal(afterDom.protected[name], beforeDom.protected[name], `Formatting changed ${name} literal whitespace`);
    }
    for (const name of ['inline', 'at-sign', 'escaped']) {
      assert.equal(visibleText(afterDom.protected[name]), visibleText(beforeDom.protected[name]), `Formatting changed visible ${name} text`);
    }
    assert.equal(visibleText(afterDom.protected.inline), 'one two', 'Adjacent inline elements lost their separating space');
    assert.match(afterDom.protected.escaped, /@literal Keep this escaped at sign\./);
    assert.equal(afterDom.protected.escaped.includes('@@literal'), false, 'The backend should render exactly one literal @');
    assert.deepEqual(executeFixtureScript(afterDom.scripts), executeFixtureScript(beforeDom.scripts), 'Formatting changed JavaScript behavior or template strings');
    assert.deepEqual(fixtureCssDeclarations(afterDom.styles), fixtureCssDeclarations(beforeDom.styles), 'Formatting changed resolved CSS declarations');
    assert.notDeepEqual(afterDom.styles, beforeDom.styles, 'Embedded CSS should be formatted');
    assert.notDeepEqual(afterDom.scripts, beforeDom.scripts, 'Embedded JavaScript should be formatted');
  }

  console.log(`PASS ${path.relative(packageRoot, sourceFile)}: backend schema, defaults and rendered semantics preserved`);
}

async function main() {
  try {
    await fs.access(path.join(applicationRoot, 'vendor/autoload.php'));
  } catch {
    throw new Error('Run composer install in the repository root before testing formatter/runtime integration.');
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'tpl-formatter-runtime-'));
  try {
    await verifyFile(path.join(fixtureRoot, 'semantics.tpl'), temporary, true);
    for (const name of ['article-template.html', 'rich-text-template.tpl']) {
      const sample = path.join(packageRoot, 'test/fixtures', name);
      if (await fs.access(sample).then(() => true, () => false)) {
        await verifyFile(sample, temporary, false);
      } else {
        console.log(`SKIP public ${name}: example is not present in this checkout`);
      }
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
