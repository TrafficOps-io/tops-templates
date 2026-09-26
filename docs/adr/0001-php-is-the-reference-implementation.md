---
status: accepted
---

# PHP template-dsl is the reference implementation; the portable runtime may only be stricter

The language has two implementations: `template-dsl` in PHP, used by hosting
applications, and the portable JavaScript runtime used by the CLI and Template
Studio. They have drifted (type coercion, text length limits, relative URLs,
truthiness of `"0"`, include depth, output budgets). We decided that PHP is the
reference: whatever it accepts and renders is the contract, and the portable
runtime must produce the same output or reject more, never accept more. Every
divergence found today is a bug in the JavaScript side, except numeric limits,
where the JavaScript side adopts the PHP values. The alternative, a shared spec
with two equal implementations, gives no way to settle disagreements.
