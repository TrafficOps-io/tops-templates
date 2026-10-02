<script setup>
import {withBase} from 'vitepress';

const tools = [
  {title: 'Landing Studio', detail: 'Edit content, preview your page, and export a ZIP.', label: 'Open the editor', href: 'https://studio.trafficops.io', external: true},
  {title: 'Command line', detail: 'Generate pages locally or include them in your build.', label: 'Use the CLI', href: '/guide/tooling'},
  {title: 'PHP & Laravel', detail: 'Parse, validate, and render templates in your application.', label: 'Integrate PHP', href: '/guide/php'},
];
</script>

<template>
  <main id="docs-main-content" class="docs-home">
    <section class="docs-entry" aria-labelledby="docs-home-title">
      <div class="docs-entry-copy">
        <h1 id="docs-home-title">TrafficOps<br>Templates</h1>
        <p class="docs-entry-summary">Typed, editable content beside your HTML. Create pages in Studio or render them from your application.</p>
        <div class="docs-entry-links">
          <a :href="withBase('/guide/getting-started')">Get started <span aria-hidden="true">→</span></a>
          <a :href="withBase('/guide/language')">Explore the language <span aria-hidden="true">→</span></a>
        </div>
      </div>
      <div class="docs-workflows" aria-label="Choose your workflow">
        <a v-for="tool in tools" :key="tool.title" :href="tool.external ? tool.href : withBase(tool.href)" class="docs-workflow-link" :target="tool.external ? '_blank' : undefined" :rel="tool.external ? 'noopener noreferrer' : undefined">
          <span class="docs-workflow-copy"><strong>{{tool.title}}</strong><span>{{tool.detail}}</span><span class="docs-workflow-action">{{tool.label}}</span></span>
          <span class="docs-workflow-arrow" aria-hidden="true">{{tool.external ? '↗' : '→'}}</span>
        </a>
      </div>
    </section>

    <section class="docs-example" aria-labelledby="start-with-one-file">
      <div class="docs-example-intro">
        <h2 id="start-with-one-file" tabindex="-1">Start with one file<a class="header-anchor" href="#start-with-one-file" aria-label="Permalink to Start with one file">​</a></h2>
        <p>Declare an editable title, then use it in ordinary HTML. Changing the parameter changes the rendered heading.</p>
        <a :href="withBase('/guide/first-template')">Build your first template <span aria-hidden="true">→</span></a>
        <div class="docs-reference-links">
          <span>Reference</span>
          <a :href="withBase('/language-v1')">Language v1</a>
          <a :href="withBase('/guide/dialects')">Dialects</a>
        </div>
      </div>
      <div class="docs-example-source">
        <slot />
      </div>
    </section>
  </main>
</template>
