# TextMate grammar test fixtures

These unmodified JSON grammars were copied from the built-in extensions in
Visual Studio Code 1.137.0. They make grammar tests deterministic and exercise
the same HTML, CSS and JavaScript embedding used by VS Code, without requiring
a VS Code installation or network requests during the test run.

| Fixture | VS Code source path | Upstream revision |
| --- | --- | --- |
| `html.tmLanguage.json` | `extensions/html/syntaxes/html.tmLanguage.json` | [textmate/html.tmbundle @ 0c3d5ee](https://github.com/textmate/html.tmbundle/commit/0c3d5ee54de3a993f747f54186b73a4d2d3c44a2) |
| `css.tmLanguage.json` | `extensions/css/syntaxes/css.tmLanguage.json` | [microsoft/vscode-css @ de9e6be](https://github.com/microsoft/vscode-css/commit/de9e6beee756760f31b15efbd782735fc25de3db) |
| `javascript.tmLanguage.json` | `extensions/javascript/syntaxes/JavaScript.tmLanguage.json` | [microsoft/TypeScript-TmLanguage @ 48f6086](https://github.com/microsoft/TypeScript-TmLanguage/commit/48f608692aa6d6ad7bd65b478187906c798234a8) |

Source repository: [microsoft/vscode](https://github.com/microsoft/vscode).
Each fixture also retains its upstream URL and revision in its own metadata.
See [LICENSES.txt](LICENSES.txt) for the TextMate Bundle and MIT licenses and
attributions copied from the installed VS Code distribution's
`ThirdPartyNotices.txt`. These files are used only in development tests and are
excluded from the extension package.
