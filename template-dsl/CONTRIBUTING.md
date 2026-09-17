# Contributing

Thank you for helping improve Template DSL. Bug reports, compatibility fixtures, documentation fixes and focused pull requests are welcome.

## Development setup

Requirements are PHP 8.4, Composer, DOM and Mbstring. From this package directory:

```sh
composer install
composer check
```

`composer check` runs strict Composer validation, Pint in check mode, PHPUnit and `composer audit`. Run a focused test while iterating, then the complete command before submitting a change:

```sh
vendor/bin/phpunit --filter TemplateEngineTest
```

Do not commit `vendor/`, Composer's lock file for this library, PHPUnit caches or generated release archives.

## Change expectations

- Add regression tests for behavior changes and malformed-input cases.
- Keep parser and renderer limits explicit, deterministic and testable.
- Treat public constructor parameter names as API because callers may use named arguments.
- Treat definition version 1, directive syntax, dialect IDs and profile JSON as compatibility contracts.
- Do not make permissive behavior the default to preserve compatibility.
- Keep filesystem, HTTP, storage, archive, database and publication policy in the host application.
- Update the relevant language, dialect, threat-model and changelog documentation.

Security-sensitive changes should include tests for both the accepted case and nearby rejected cases. New or expanded dialect capabilities must document the trust level, source and output path policy, runtime context, executable-output behavior and host obligations. A dialect must never allow template source to select itself.

The JSON Schema and dialect profiles are interoperability artifacts, not replacements for runtime validation. Update them with corresponding PHP tests whenever their represented contract changes.

## Pull requests

Keep changes scoped and explain:

1. the user-visible or security behavior being changed;
2. compatibility impact on definitions, source and dialect implementations;
3. tests and validation performed;
4. documentation or profile changes.

Do not include secrets, production templates or private vulnerability details. Follow [SECURITY.md](SECURITY.md) for disclosures.

By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE).
