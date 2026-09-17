# TrafficOps agent skills

```sh
npx skills add trafficops-io/tops-templates
npx skills add trafficops-io/tops-templates --list
npx skills add trafficops-io/tops-templates --skill trafficops-template-authoring --agent codex --agent claude-code
```

- **trafficops-template-authoring**: author `.tpl` sources, typed parameter forms, includes and local assets for the CLI/editor.
- **trafficops-template-integration**: integrate the PHP package, select dialects and validate/render page definitions in Laravel.

Each skill contains its own references so it works after installation outside this repository. Installation follows the [open skills CLI](https://github.com/vercel-labs/skills); no agent-specific runtime package is required.
