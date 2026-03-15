# tree-sitter-gicel

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for
[GICEL](https://github.com/cwd-k2/gicel) (Go's Indexed Capability
Effect Language) — a Haskell-like embedded typed effect language for Go.

## Features

- Full declaration parsing: `data`, `type`, `class`, `instance`, `import`,
  fixity, type annotations, value definitions
- Haskell-style type system: `forall`, qualified types (`=>`), type
  application, function types, row types, kinded variables
- Expressions: lambda (`\x -> ...`), `case`, `do` blocks, infix operators,
  application, records, tuples, lists, projection (`!#`), type application
  (`@`)
- Patterns: constructor patterns, wildcards, record/tuple patterns
- External scanner for declaration boundary detection (column-aware) and
  nestable block comments (`{- ... -}`)
- Syntax highlighting queries included

## Quick Start

```sh
git clone https://github.com/cwd-k2/tree-sitter-gicel.git
cd tree-sitter-gicel
npm install
npx tree-sitter generate
npx tree-sitter parse path/to/file.gicel
```

## Editor Plugins

| Editor | Plugin | Install |
| ------ | ------ | ------- |
| **Neovim** | [nvim-gicel](https://github.com/cwd-k2/nvim-gicel) | `{ "cwd-k2/nvim-gicel", dependencies = { "nvim-treesitter/nvim-treesitter" } }` then `:TSInstall gicel` |
| **Zed** | [zed-gicel](https://github.com/cwd-k2/zed-gicel) | Extensions > Install Dev Extension (or publish to registry) |
| **VS Code** | [vscode-gicel](https://github.com/cwd-k2/vscode-gicel) | TextMate grammar (no tree-sitter) |

### Helix

**1. Add to `languages.toml`:**

```toml
[[language]]
name = "gicel"
scope = "source.gicel"
file-types = ["gicel"]
comment-token = "--"
block-comment-tokens = { start = "{-", end = "-}" }
indent = { tab-width = 2, unit = "  " }

[[grammar]]
name = "gicel"
source = { git = "https://github.com/cwd-k2/tree-sitter-gicel", rev = "main" }
```

**2. Fetch and build:**

```sh
hx --grammar fetch
hx --grammar build
```

**3. Place queries:**

```sh
mkdir -p ~/.config/helix/runtime/queries/gicel
cp queries/highlights.scm ~/.config/helix/runtime/queries/gicel/
```

### Emacs (tree-sitter)

```elisp
(add-to-list 'treesit-language-source-alist
             '(gicel "https://github.com/cwd-k2/tree-sitter-gicel"))
(treesit-install-language-grammar 'gicel)

(add-to-list 'auto-mode-alist '("\\.gicel\\'" . prog-mode))
```

## Grammar Overview

```
source_file = { declaration | newline | ";" }

declaration = import | data | type_alias | fixity
            | class | instance | type_annotation | value_definition

type        = forall_type | qualified_type | function_type
            | type_application | identifier | constructor
            | unit_type | parenthesized_type | tuple_type | row_type

expression  = lambda | case | do | infix | application | atom

pattern     = constructor_pattern | simple_pattern
```

See the [grammar reference](https://github.com/cwd-k2/gicel/blob/main/docs/grammar-reference.md)
for the full language specification.

## License

MIT
