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

## Editor Integration

### Neovim (nvim-treesitter)

**1. Register the parser** in your `init.lua`:

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()

parser_config.gicel = {
  install_info = {
    url = "https://github.com/cwd-k2/tree-sitter-gicel",
    files = { "src/parser.c", "src/scanner.c" },
    branch = "main",
  },
  filetype = "gicel",
}
```

For local development, replace the `url` with an absolute path:

```lua
    url = "/path/to/tree-sitter-gicel",
```

**2. Register the filetype:**

```lua
vim.filetype.add({
  extension = {
    gicel = "gicel",
  },
})
```

**3. Install the parser:**

```vim
:TSInstall gicel
```

**4. Place the highlight queries:**

```sh
mkdir -p ~/.config/nvim/queries/gicel
ln -s /path/to/tree-sitter-gicel/queries/highlights.scm \
      ~/.config/nvim/queries/gicel/highlights.scm
```

**5. Verify:**

```vim
:e some_file.gicel
:InspectTree
```

### Zed

Zed loads tree-sitter grammars as extensions.

**1. Create the extension structure** in this repository:

```
tree-sitter-gicel/
  extension.toml
  languages/
    gicel/
      config.toml
      highlights.scm    # copy of queries/highlights.scm
```

**2. `extension.toml`** (repository root):

```toml
[extension]
id = "gicel"
name = "GICEL"
version = "0.1.0"
schema_version = 1

[language_servers]
```

**3. `languages/gicel/config.toml`:**

```toml
name = "GICEL"
grammar = "gicel"
path_suffixes = ["gicel"]
line_comments = ["-- "]
block_comment = ["{-", "-}"]
brackets = [
  { start = "(", end = ")", close = true, newline = true },
  { start = "{", end = "}", close = true, newline = true },
  { start = "[", end = "]", close = true, newline = true },
]
```

**4. Install as dev extension:**

Zed > Extensions > Install Dev Extension > select this directory.

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
