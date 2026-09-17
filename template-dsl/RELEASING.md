# Releasing

This package is developed in a monorepo. A public distribution repository and package-registry entry are intentionally not named here; configure them before the first release rather than publishing an invented URL.

## Version policy

Use `0.x` versions while the public PHP API, language definition contract and dialect extension points are being stabilized. Within `0.x`, treat definition version 1, stored definitions, directive syntax, dialect IDs, public method signatures and named constructor parameters as compatibility-sensitive. A language-format change does not automatically require the same number as the Composer package version.

## Release checklist

1. Choose the package version and review all changes since the previous package tag.
2. Move relevant entries from `Unreleased` into a dated changelog section. Document migrations and security impact.
3. Verify that documentation, `resources/schema` and `resources/dialects` match the implementation and compatibility fixtures.
4. From a clean checkout of the package contents, install locked-compatible dependencies for testing and run:

   ```sh
   composer validate --strict
   composer lint
   composer test
   composer security
   php -r 'foreach (array_merge(glob("resources/schema/*.json"), glob("resources/dialects/*.json")) as $file) { json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR); echo $file, PHP_EOL; }'
   ```

5. Build a source archive with `composer archive --format=zip` and inspect it. It must contain runtime source, documentation, resources, license, changelog and security policy; it must not contain tests, local caches or development-only repository files.
6. Install the archive in a minimal Laravel 12 application and smoke-test package discovery, parsing, definition validation and `safe-html-v1` rendering.
7. Confirm that applications using an application-owned dialect pass their integration and golden-fixture suites against the release candidate.
8. Confirm provenance and third-party license compatibility for every shipped file.
9. Tag the commit immutably and publish the exact tag through the configured package repository. Do not use a moving branch alias as an application release dependency.
10. Verify the registry metadata and archive from a fresh consumer installation, then announce the release notes.

If the package is subtree-split from the monorepo, create package tags in the split repository from the exact reviewed monorepo commit. Never recreate or move an existing release tag.

For a security release, coordinate disclosure through [SECURITY.md](SECURITY.md), publish the fixed tag before public technical details, and identify every affected version range.
