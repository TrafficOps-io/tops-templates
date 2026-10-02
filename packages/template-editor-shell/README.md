# Template editor shell

The shared React editor for Landing Studio, HTTP embedding and custom hosts.
Storage, analysis, lifecycle and AI transport are supplied through the `EditorHost`
ports from `@trafficops/template-editor-core`. Project compilation uses the host
analyzer. Rich-text editing uses the runtime's sanitizer locally. The shell does
not read API keys from storage or know a server wire format.

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

`ParameterForm` loads Tiptap visual editors for WYSIWYG and Markdown fields on
demand. Both provide formatting, links, project images and uploads; WYSIWYG also
supports editable figures/captions. Markdown has an optional source/preview mode.
Stored values remain HTML/Markdown source and never contain preview blob URLs.
Legacy WYSIWYG paragraph/quote recovery is batched across sibling and nested
fields. Pass `disabled` to `ParameterForm` when content editing is locked; unlike
native controls, contenteditable elements do not inherit a disabled fieldset.

`host.livePreview` enables interactive JavaScript previews. Updates are coalesced;
the last working iframe stays mounted and interactive while a replacement loads
at the same dimensions. Incomplete source/errors leave that working preview in
place. Users can pause automatic updates, refresh once, or resume. Preview does
not save or publish the project. Hosts without this optional port keep the static
renderer. See the core contract for readiness, revision retention and disposal.

AI editing calls the host analyzer for both tool validation and the final draft.
The text and image connections come only from `host.ai`; settings expose writes
only when their owner is `user`. `host` ownership offers status, connection testing
and the supplied team settings URL.

When AI is available, **Files → Edit file with AI** opens the shared chat with
the File scope set to the selected source or PNG/JPEG/WebP asset: editing one
file is the File scope of the common conversation, not a separate dialog. The run
acquires a connection through the same AI port and validates with the host
analyzer; its writer can only replace the scoped path, and reference attachments
cannot add project assets. Applying merges that one file into the current project
and follows the normal host save policy. Prompts attach bounded images, PDF or
UTF-8 text documents through `StudioComposer` from `@trafficops/studio-ui/chat`;
the pure `file-ai-workflow` / `file-ai-attachments` helpers stay exported for
custom hosts.

`StudioComposer` accepts images pasted into the prompt with Ctrl+V or ⌘V and
applies the same attachment limits and busy state as file uploads; text paste
stays native.

## Persistent conversations

Hosts may supply `host.conversations` independently of `ProjectState.history`. `conversation-runtime` owns execution outside React: two run slots per app window, addressed stop/finish, frozen input and language, versioned checkpoints, owner leases and Web Locks, and explicit continuation after reload. `StudioChat` (from `@trafficops/studio-ui/chat`, fed by `chat-port`) uses one composer for project, content, discussion, file and block scopes. Views can unsubscribe or switch projects without cancelling execution. Preview selection includes a searchable multi-select list for the current iframe page. The composer accepts file and section mentions together; section identities come from the matching preview snapshot, retain source fragments and instance values, and never change the conversation scope. Outdated references fail before a provider connection.

`useEditorProject.applyConversationDraft` performs conservative three-way file/value merging, requires explicit review of stale context, validates/renders the final candidate and commits applied-run IDs with canonical content. Draft preview has its own analysis and never enters source editing or autosave. `presentation="app"` renders a permanent workspace; embedded presentation and hosts without the optional port keep their existing behavior. App integrations can provide `onSaveToFolder`, `storageSummary` and `onImportProject` to coordinate portable identity instead of replacing source in place.

## Shared studio UI

Menu, Modal, ResizableWorkspace, focus helpers and i18n are provided by `@trafficops/studio-ui`; the shell re-exports them at their previous paths. The `./studio-translations` export was removed; import the dictionary from `@trafficops/studio-ui/i18n/studio-translations` or use `studio-i18n`.
