import {Command} from 'commander';
import {parseProject, generateProject} from '../../runtime/src/index.js';
import {readProject, readJson, writeProject} from './io.js';

const program = new Command()
  .name('tops')
  .description('Generate static pages from TrafficOps templates. Omit --data to open an interactive Ink form.')
  .version('0.1.0')
  .requiredOption('-t, --template <path>', 'template .tpl/.tpl.html file or project directory')
  .option('-d, --data <json>', 'JSON values; bypasses the interactive form')
  .option('-o, --output <directory>', 'generated output directory', './generated')
  .option('--context <json>', 'optional JSON runtime context: query, locale and actions')
  .option('-f, --force', 'replace existing generated files')
  .showHelpAfterError()
  .action(async (options) => {
    const project = await readProject(options.template);
    const {definition} = parseProject(project.files);
    let data;
    if (options.data) data = await readJson(options.data);
    else {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Interactive mode needs a terminal. Provide --data values.json for noninteractive generation.');
      const {promptValues} = await import('./tui.js');
      data = await promptValues(definition);
    }
    const context = options.context ? await readJson(options.context) : {};
    const files = generateProject(project.files, data, context);
    const output = await writeProject(files, options.output, {force:options.force, sourceRoot:project.root, sourceIsDirectory:project.directory});
    process.stdout.write(`Generated ${Object.keys(files).length} file(s) in ${output}\n`);
  });

try { await program.parseAsync(process.argv); }
catch (error) { process.stderr.write(`Error: ${error.message}\n`); process.exitCode = 1; }
