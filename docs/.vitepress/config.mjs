import {readFileSync} from 'node:fs';
import {bundledLanguages} from 'shiki';
import {defineConfig} from 'vitepress';

const repository = 'https://github.com/TrafficOps-io/tops-templates';
const tplGrammar = JSON.parse(
  readFileSync(
    new URL('../../vscode-extension/syntaxes/fast-landings-tpl.tmLanguage.json', import.meta.url),
    'utf8',
  ),
);

const tplLanguage = {
  ...tplGrammar,
  name: 'tpl',
  displayName: 'TrafficOps Template',
  aliases: ['trafficops-template'],
  embeddedLangs: ['html', 'php'],
};

export default defineConfig({
  lang: 'en-US',
  title: 'TrafficOps Templates',
  description: 'A template language and local-first tools for building static pages.',
  base: '/tops-templates/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['README.md'],
  head: [
    ['meta', {name: 'theme-color', content: '#ec684d'}],
  ],
  markdown: {
    lineNumbers: true,
    languages: [bundledLanguages.html, bundledLanguages.php, tplLanguage],
    config(md) {
      md.renderer.rules.code_inline = (tokens, index) => {
        const content = md.utils.escapeHtml(tokens[index].content);
        return `<code v-pre>${content}</code>`;
      };
    },
  },
  themeConfig: {
    siteTitle: 'TrafficOps Templates',
    logo: '/logo.svg',
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: 'Search',
            buttonAriaLabel: 'Search documentation',
          },
          modal: {
            noResultsText: 'No results found',
            resetButtonTitle: 'Reset search',
            footer: {
              selectText: 'select',
              navigateText: 'navigate',
              closeText: 'close',
            },
          },
        },
      },
    },
    nav: [
      {text: 'Guide', link: '/guide/getting-started'},
      {text: 'Language', link: '/guide/language'},
      {text: 'PHP', link: '/guide/php'},
      {text: 'CLI & Editor', link: '/guide/tooling'},
      {text: 'Editor', link: 'https://trafficops-templates.netlify.app'},
    ],
    sidebar: [
      {
        text: 'Getting started',
        items: [
          {text: 'Overview', link: '/guide/getting-started'},
          {text: 'First template', link: '/guide/first-template'},
        ],
      },
      {
        text: 'Template language',
        items: [
          {text: 'Syntax', link: '/guide/language'},
          {text: 'Dialects', link: '/guide/dialects'},
          {text: 'Language v1 — reference', link: '/language-v1'},
          {text: 'Dialect API — reference', link: '/dialects'},
          {text: 'Threat model', link: '/threat-model'},
        ],
      },
      {
        text: 'Integration',
        items: [
          {text: 'PHP and Laravel', link: '/guide/php'},
          {text: 'CLI and Template Studio', link: '/guide/tooling'},
          {text: 'Publishing the docs', link: '/guide/documentation'},
        ],
      },
    ],
    socialLinks: [
      {icon: 'github', link: repository},
    ],
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    lastUpdated: {
      text: 'Last updated',
      formatOptions: {
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    },
    docFooter: {
      prev: 'Previous page',
      next: 'Next page',
    },
    outline: {
      label: 'On this page',
      level: [2, 3],
    },
    returnToTopLabel: 'Return to top',
    sidebarMenuLabel: 'Menu',
    darkModeSwitchLabel: 'Theme',
    lightModeSwitchTitle: 'Switch to light theme',
    darkModeSwitchTitle: 'Switch to dark theme',
    footer: {
      message: 'The documentation ships with the project.',
      copyright: 'MIT License · TrafficOps contributors',
    },
  },
});
