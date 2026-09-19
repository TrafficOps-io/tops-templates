# Template editor shell

The shared React editor for Landing Studio, HTTP embedding and custom hosts.
Storage, analysis, lifecycle and AI transport are supplied through the `EditorHost`
ports from `@trafficops/template-editor-core`. The shell does not import a compiler,
read API keys from storage or know a server wire format.

```jsx
import EditorShell from '@trafficops/template-editor-shell';
import '@trafficops/template-editor-shell/shell.css';

<EditorShell host={host} />
```

Use React 19, Monaco and a JSX-aware bundler. Process the CSS with Tailwind CSS 4
and daisyUI 5; it contains no font or application theme. Supply the daisyUI
`--color-*` and `--radius-*` variables at the mount point. Shared semantic tokens
are declared on `.editor-root`, including dialogs. Studio adds its font and theme
in `studio.css`; the embedded entry inherits the application's theme through its
ShadowRoot and loads CSS before mounting React.

Optional presentation props: `previewExpandButton`, `initialExpanded`, `showExportFooter`,
`onNewProject`, `onManageProjects`, `projectSwitcher`, `storageHelp`, `onSnapshot`.
These do not change the host contract. The core conformance runner accepts the
same host factory without requiring React or a DOM.

AI editing calls the host analyzer for both tool validation and the final draft.
The text and image connections come only from `host.ai`; settings expose writes
only when their owner is `user`. `host` ownership offers status, connection testing
and the supplied team settings URL.
