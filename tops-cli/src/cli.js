import {Command} from 'commander';
import {parseProject, generateProject} from '../../runtime/src/index.js';
import {readProject, readJson, writeProject} from './io.js';
import {initRepository, addTemplate, bundleRepository} from './repositories.js';

const program = new Command()
  .name('tops')
  .description('Generate static pages or publish template repositories. Omit --data for the page-generation form.')
  .usage('[options] | repo <command>')
  .enablePositionalOptions()
  .version('0.1.0')
  .option('-t, --template <path>', 'template .tpl/.tpl.html file or project directory (required for page generation)')
  .option('-d, --data <json>', 'JSON values; bypasses the interactive form')
  .option('-o, --output <directory>', 'generated output directory', './generated')
  .option('--context <json>', 'optional JSON runtime context: query, locale and actions')
  .option('-f, --force', 'replace existing generated files')
  .showHelpAfterError()
  .action(async (options) => {
    if (!options.template) throw new Error('Provide --template <path> to generate pages, or use tops repo --help to manage template repositories.');
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

const repository = program.command('repo').alias('repository')
  .description('Create, populate and bundle static template repositories')
  .showHelpAfterError();

repository.command('init [directory]')
  .description('Create a repository.json and templates directory')
  .requiredOption('--name <name>', 'repository display name')
  .option('--description <text>', 'repository description')
  .option('--author <author>', 'repository author or team')
  .option('--homepage <url>', 'repository HTTP(S) homepage')
  .action(async (directory = '.', options) => {
    const {root} = await initRepository(directory, options);
    process.stdout.write(`Created repository in ${root}\nFrom that directory, add a template with: tops repo add --name "My template" --path /path/to/template\n`);
  });

repository.command('add [directory]')
  .description('Copy a template and its assets into a repository')
  .requiredOption('--path <path>', 'template directory or .tpl/.tpl.html file')
  .requiredOption('--name <name>', 'template display name')
  .option('--id <id>', 'unique template ID (default: slug derived from name)')
  .option('--description <text>', 'template description')
  .option('--version <version>', 'template version label', '1.0.0')
  .option('--thumbnail <path-or-url>', 'local thumbnail image or HTTP(S) image URL')
  .option('--data <json>', 'JSON field values to include with the template')
  .action(async (directory = '.', options) => {
    const {root, entry} = await addTemplate(directory, options);
    process.stdout.write(`Added ${entry.name} (${entry.id}) to ${root}\n`);
  });

repository.command('bundle [directory]')
  .description('Build index.json, ZIPs and previews ready for a static host')
  .option('-o, --output <directory>', 'bundle directory (default: <repository>/dist)')
  .option('-f, --force', 'replace bundle files in an existing output directory')
  .action(async (directory = '.', options) => {
    const {output, index} = await bundleRepository(directory, options);
    process.stdout.write(`Bundled ${index.templates.length} template(s) in ${output}\nUpload this directory to a static host, then add its index.json URL in Landing Studio Settings.\n`);
  });

try { await program.parseAsync(process.argv); }
catch (error) { process.stderr.write(`Error: ${error.message}\n`); process.exitCode = 1; }
