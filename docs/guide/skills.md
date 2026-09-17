# Agent skills

TrafficOps Templates includes two installable skills for coding agents. They package the project-specific instructions and references an agent needs to author portable templates or integrate the PHP runtime without guessing at syntax, dialect support, or security boundaries.

## Install the skills

Install every skill from the repository:

```sh
npx skills add trafficops-io/tops-templates
```

List the available skills before installing:

```sh
npx skills add trafficops-io/tops-templates --list
```

Install one skill for selected agents:

```sh
npx skills add trafficops-io/tops-templates \
  --skill trafficops-template-authoring \
  --agent codex \
  --agent claude-code
```

Installation uses the [open skills CLI](https://github.com/vercel-labs/skills). The skills are self-contained, so their reference files travel with the installation and do not require an agent-specific runtime package.

## Available skills

### `trafficops-template-authoring`

Use this skill when asking an agent to create or edit `.tpl` projects for the CLI or Template Studio. It covers typed parameters, sections, repeaters, includes, local assets, safe interpolation, portable runtime limits, generation, and output inspection.

Example request:

> Create a portable TrafficOps campaign template with editable hero content and a repeating benefits list. Validate it with the CLI and inspect the generated asset paths.

### `trafficops-template-integration`

Use this skill when integrating `trafficops/template-dsl` into PHP or Laravel. It covers parser and engine resolution, explicit dialect selection, typed value validation, include isolation, rendering context, and the boundary between library guarantees and host application policy.

Example request:

> Integrate the TrafficOps template DSL into this Laravel application using `safe-html-v1`, an isolated include resolver, and tests for invalid values and path traversal.

## Choose the right skill

| Task | Skill |
| --- | --- |
| Write or revise template source | `trafficops-template-authoring` |
| Build a project for the CLI or browser editor | `trafficops-template-authoring` |
| Add the Composer package to PHP or Laravel | `trafficops-template-integration` |
| Implement a host-owned dialect or include resolver | `trafficops-template-integration` |
| Author templates and wire them into an application | Install both |

The source files live in [`skills/`](https://github.com/TrafficOps-io/tops-templates/tree/main/skills). Review a skill there when you need to audit the exact instructions distributed to an agent.
