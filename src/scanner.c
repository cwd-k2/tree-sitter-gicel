/**
 * External scanner for GICEL's tree-sitter grammar.
 *
 * Responsibilities:
 *   1. Track brace depth via _open_brace / _close_brace tokens.
 *   2. Emit _newline at top-level declaration boundaries (depth 0).
 *   3. Parse nestable block comments {- … -}.
 *
 * _newline is emitted only when:
 *   - brace depth is 0
 *   - the scanner encounters a newline
 *   - the next non-whitespace character could start a declaration
 *     (a-z, A-Z, _, or '(')
 *
 * This mirrors the GICEL parser's atDeclBoundary() semantics.
 */

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>
#include <string.h>

enum TokenType {
  TOKEN_NEWLINE,
  TOKEN_BLOCK_COMMENT,
  TOKEN_OPEN_BRACE,
  TOKEN_CLOSE_BRACE,
};

typedef struct {
  uint16_t brace_depth;
} Scanner;

/* ── Lifecycle ────────────────────────────────────────────────────── */

void *tree_sitter_gicel_external_scanner_create(void) {
  Scanner *s = calloc(1, sizeof(Scanner));
  return s;
}

void tree_sitter_gicel_external_scanner_destroy(void *payload) {
  free(payload);
}

unsigned tree_sitter_gicel_external_scanner_serialize(void *payload,
                                                      char *buffer) {
  Scanner *s = (Scanner *)payload;
  memcpy(buffer, &s->brace_depth, sizeof(s->brace_depth));
  return sizeof(s->brace_depth);
}

void tree_sitter_gicel_external_scanner_deserialize(void *payload,
                                                    const char *buffer,
                                                    unsigned length) {
  Scanner *s = (Scanner *)payload;
  if (length >= sizeof(s->brace_depth)) {
    memcpy(&s->brace_depth, buffer, sizeof(s->brace_depth));
  } else {
    s->brace_depth = 0;
  }
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
  Scanner *s = (Scanner *)payload;

  skip_horizontal_ws(lexer);

  /* ── Newline at top level ──────────────────────────────────────── */
  if (lexer->lookahead == '\n' && s->brace_depth == 0 &&
      valid_symbols[TOKEN_NEWLINE]) {
    /* Consume leading newlines and whitespace. */
    while (lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
           lexer->lookahead == ' ' || lexer->lookahead == '\t') {
      lexer->advance(lexer, true);
    }
    /* Skip line comments that precede the next declaration. */
    while (lexer->lookahead == '-') {
      lexer->advance(lexer, true);
      if (lexer->lookahead != '-') break;
      /* It's a line comment — consume until newline. */
      while (lexer->lookahead != '\n' && lexer->lookahead != 0) {
        lexer->advance(lexer, true);
      }
      /* Consume trailing whitespace after the comment. */
      while (lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
             lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        lexer->advance(lexer, true);
      }
    }
    lexer->mark_end(lexer);

    if (is_decl_start_char(lexer->lookahead)) {
      lexer->result_symbol = TOKEN_NEWLINE;
      return true;
    }
    /* Not a declaration boundary — fall through so \n is consumed as extra. */
    return false;
  }

  /* ── Open brace or block comment ───────────────────────────────── */
  if (lexer->lookahead == '{') {
    lexer->advance(lexer, false);

    /* {- starts a block comment */
    if (lexer->lookahead == '-' && valid_symbols[TOKEN_BLOCK_COMMENT]) {
      lexer->advance(lexer, false);
      scan_block_comment_body(lexer);
      lexer->mark_end(lexer);
      lexer->result_symbol = TOKEN_BLOCK_COMMENT;
      return true;
    }

    /* Otherwise it's an open brace. */
    if (valid_symbols[TOKEN_OPEN_BRACE]) {
      lexer->mark_end(lexer);
      s->brace_depth++;
      lexer->result_symbol = TOKEN_OPEN_BRACE;
      return true;
    }

    return false;
  }

  /* ── Close brace ───────────────────────────────────────────────── */
  if (lexer->lookahead == '}' && valid_symbols[TOKEN_CLOSE_BRACE]) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    if (s->brace_depth > 0)
      s->brace_depth--;
    lexer->result_symbol = TOKEN_CLOSE_BRACE;
    return true;
  }

  return false;
}
