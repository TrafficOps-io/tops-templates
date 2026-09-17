# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and tagged releases will follow Semantic Versioning.

## [Unreleased]

### Added

- Version 1 template source parsing, normalized definitions, typed settings and bounded HTML rendering.
- The default non-executable `safe-html-v1` dialect and safe runtime strategy.
- Host-selected dialect APIs: `TemplateDialect`, `PreparedSource`, `DirectiveExtraction`, `SourcePhase` and `TemplateRuntimeStrategy`.
- `LiteralRuntimeStrategy` for trusted hosts that preserve application-owned runtime syntax for later processing.
- Language, dialect and threat-model documentation, plus definition schema and dialect capability profiles.
- MIT license, contribution, security and release policies.

### Fixed

- The definition schema now accepts the real JSON encoding of normalized empty PHP maps and sequential numeric select options, and is covered by engine-to-schema fixtures.
- Reserved field metadata is validated only on its supported field types instead of being silently retained with inactive semantics.

### Security

- Dialect selection remains exclusively host-controlled; template source cannot opt into a more permissive dialect.
- Core path, size, nesting, expansion and rendering budgets remain active for every dialect, including independent aggregate raw/prepared/finished-page accounting.
- Directive extraction is limited to stable removal of exact tokens and cannot mutate page topology.
- Parser and renderer hook results are revalidated for UTF-8 text, null bytes, opaque-marker shape and final output limits; runtime-strategy nodes remain charged to the common budget.

Release comparison links will be added when a public repository and the first tag exist.
