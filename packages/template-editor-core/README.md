# @trafficops/template-editor-core

Headless files, archives, host contracts, errors and conformance checks. This
package has no React, DOM, Monaco, language-core or runtime dependency. `fflate`
handles ZIP bytes. Browser download links and directory storage belong to hosts.

`contract.d.ts` is the boundary for project state, analysis, history, actions,
previews, AI connection transport and settings. Hosts must return normalized
errors with codes `conflict`, `validation`, `policy`, `transport` or `abort`.
Capabilities remain fixed for a host session; project `availability` can narrow
inline preview, external preview and AI access. Missing optional ports have no key.

`validateDialectDescriptor(descriptor, knownIds)` validates the host metadata using
a caller-owned registry. An empty `allowedEntrypoints` whitelist means no known
entrypoint is currently available, not a selected page. The project state owns
its selected `entrypoint`. Authoritative hosts enforce their own policy on save.

Run `runHostConformance(factory, { knownIds, faults })` against a **fresh disposable
test workspace**: the kit saves files, attempts a stale revision, round trips ZIPs,
and cancels operations. Optional `faults` inject transport/permission/validation
failures through the real adapter. Do not run it against a user's live project.

The editor tests run it against Studio's directory adapter, HttpHost's protocol
mock, and a third host. The third host changes their shared safe dialect, numeric
revision and always-available HTML rendering assumptions: it uses the trusted
dialect, an opaque revision string, project-gated preview and no HTML export.

The canonical interoperability corpus is under `fixtures/`. Both the Studio
AnalyzerPort tests and PWApps PHP ProjectAnalyzer tests consume these files.
Diagnostic parity compares stable code, locale, section, field path, source file
and line. Localized human messages must exist but are not compared byte for byte.
PWApps installs this package for its tests; there is no second maintained corpus.
