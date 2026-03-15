/**
 * External scanner for GICEL's tree-sitter grammar.
 *
 * Responsibilities:
 *   1. Emit _newline at top-level declaration boundaries.
 *   2. Parse nestable block comments {- … -}.
 *
 * _newline is emitted when:
 *   - valid_symbols[TOKEN_NEWLINE] is true (only at source_file level)
 *   - the scanner encounters a newline
 *   - the next non-whitespace character could start a declaration
 *     (a-z, A-Z, _, or '(')
 *
 * Brace depth is NOT tracked: tree-sitter's parser state ensures
 * TOKEN_NEWLINE is only valid at the top level (source_file rule).
 */

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>

enum TokenType {
  TOKEN_NEWLINE,
  TOKEN_BLOCK_COMMENT,
};

/* ── Lifecycle ────────────────────────────────────────────────────── */

void *tree_sitter_gicel_external_scanner_create(void) {
  return NULL;
}

void tree_sitter_gicel_external_scanner_destroy(void *payload) {
  (void)payload;
}

unsigned tree_sitter_gicel_external_scanner_serialize(void *payload,
                                                      char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}

void tree_sitter_gicel_external_scanner_deserialize(void *payload,
                                                    const char *buffer,
                                                    unsigned length) {
  (void)payload;
  (void)buffer;
  (void)length;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

static inline bool is_decl_start_char(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' ||
         c == '(';
}

static inline void skip_horizontal_ws(TSLexer *lexer) {
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
         lexer->lookahead == '\r') {
    lexer->advance(lexer, true);
  }
}

/**
 * Parse a nestable block comment body (called after consuming "{-").
 * Returns true on success (balanced close found).
 */
static bool scan_block_comment_body(TSLexer *lexer) {
  int depth = 1;
  while (depth > 0) {
    if (lexer->eof(lexer))
      return false;
    if (lexer->lookahead == '{') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '-') {
        depth++;
        lexer->advance(lexer, false);
      }
    } else if (lexer->lookahead == '-') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '}') {
        depth--;
        lexer->advance(lexer, false);
      }
    } else {
      lexer->advance(lexer, false);
    }
  }
  return true;
}

/* ── Main scan ────────────────────────────────────────────────────── */

bool tree_sitter_gicel_external_scanner_scan(void *payload, TSLexer *lexer,
                                             const bool *valid_symbols) {
  (void)payload;

  skip_horizontal_ws(lexer);

  /* ── Newline at top level ──────────────────────────────────────── */
  if (lexer->lookahead == '\n' && valid_symbols[TOKEN_NEWLINE]) {
    /* Consume leading newlines and whitespace. */
    while (lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
           lexer->lookahead == ' ' || lexer->lookahead == '\t') {
      lexer->advance(lexer, true);
    }
    /* Skip line comments that precede the next declaration.
       mark_end before entering the loop: if the first '-' is not followed
       by another '-', the consumed character must not be part of the
       emitted token. mark_end anchors the token boundary here. */
    lexer->mark_end(lexer);
    while (lexer->lookahead == '-') {
      lexer->advance(lexer, false);
      if (lexer->lookahead != '-') break;
      /* It's a line comment — consume until newline. */
      while (lexer->lookahead != '\n' && lexer->lookahead != 0) {
        lexer->advance(lexer, false);
      }
      /* Consume trailing whitespace after the comment. */
      while (lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
             lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        lexer->advance(lexer, false);
      }
      lexer->mark_end(lexer);
    }

    /* Only emit _newline when the next token is at column 0 (unindented).
       Indented continuations (column > 0) are NOT declaration boundaries.
       This mirrors the GICEL parser's atDeclBoundary() semantics. */
    if (is_decl_start_char(lexer->lookahead) &&
        lexer->get_column(lexer) == 0) {
      lexer->result_symbol = TOKEN_NEWLINE;
      return true;
    }
    /* Not a declaration boundary — fall through to block comment check.
       After consuming whitespace, the lookahead might be '{' for {- ... -}.
       Returning false here would let the regular lexer consume '{' as a
       brace token, missing the block comment. */
  }

  /* ── Block comment {- … -} ─────────────────────────────────────── */
  if (lexer->lookahead == '{' && valid_symbols[TOKEN_BLOCK_COMMENT]) {
    lexer->mark_end(lexer);
    lexer->advance(lexer, false);
    if (lexer->lookahead == '-') {
      lexer->advance(lexer, false);
      scan_block_comment_body(lexer);
      lexer->mark_end(lexer);
      lexer->result_symbol = TOKEN_BLOCK_COMMENT;
      return true;
    }
    return false;
  }

  return false;
}
