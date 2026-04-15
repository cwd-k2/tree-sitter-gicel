/**
 * External scanner for GICEL's tree-sitter grammar.
 *
 * Responsibilities:
 *   1. Emit _newline at top-level declaration boundaries.
 *   2. Parse nestable block comments {- ... -}.
 *   3. Emit _case_brace when `{` appears in a case_expression context.
 *   4. Emit _stmt_end at newlines within braced bodies (do, case, etc.)
 *      for implicit statement separation.
 *
 * _newline is emitted when:
 *   - valid_symbols[TOKEN_NEWLINE] is true (only at source_file level)
 *   - the scanner encounters a newline
 *   - the next non-whitespace character could start a declaration
 *     (a-z, A-Z, _, or '(')
 *
 * _stmt_end is emitted when:
 *   - valid_symbols[TOKEN_STMT_END] is true (inside braced bodies)
 *   - the scanner encounters a newline
 *   - the next non-whitespace character is at column > 0 (not a
 *     declaration boundary) and is not `}`
 *   This mirrors GICEL's parseBody() semantics where newlines at the
 *   same brace depth act as implicit semicolons.
 *
 * _case_brace is emitted when:
 *   - valid_symbols[TOKEN_CASE_BRACE] is true (after case scrutinee)
 *   - the scanner sees `{`
 *   This prevents the LALR shift-reduce conflict between case body `{`
 *   and block_expression `{`.
 *
 * Brace depth is NOT tracked: tree-sitter's parser state ensures
 * TOKEN_NEWLINE is only valid at the top level (source_file rule),
 * and TOKEN_STMT_END is only valid inside braced body constructs.
 */

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>

enum TokenType {
  TOKEN_NEWLINE,
  TOKEN_BLOCK_COMMENT,
  TOKEN_CASE_BRACE,
  TOKEN_QUALIFIED_DOT,
  TOKEN_STMT_END,
};

/* -- Lifecycle ------------------------------------------------------------ */

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

/* -- Helpers -------------------------------------------------------------- */

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

/* -- Main scan ------------------------------------------------------------ */

bool tree_sitter_gicel_external_scanner_scan(void *payload, TSLexer *lexer,
                                             const bool *valid_symbols) {
  (void)payload;

  /* -- Qualified dot (adjacency-sensitive) -------------------------------- */
  /* Must check BEFORE consuming any whitespace.  _qualified_dot is emitted
     when '.' immediately follows the previous token (no space before) AND
     is immediately followed by a letter (no space after).  This mirrors
     GICEL's tokensAdjacent() semantics: M.x is a qualified reference,
     M . x is function composition. */
  if (lexer->lookahead == '.' && valid_symbols[TOKEN_QUALIFIED_DOT]) {
    lexer->mark_end(lexer);
    lexer->advance(lexer, false);
    if ((lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
        (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z')) {
      lexer->mark_end(lexer);
      lexer->result_symbol = TOKEN_QUALIFIED_DOT;
      return true;
    }
    /* Not followed by a letter — revert to mark_end (before '.') */
    return false;
  }

  skip_horizontal_ws(lexer);

  /* -- Newline handling: _newline and _stmt_end ----------------------------- */
  /* Both tokens trigger on newlines but in different contexts:
     - _newline: top-level declaration boundaries (column 0)
     - _stmt_end: implicit semicolons inside braced bodies (column > 0)
     When both are valid (GLR overlap), _newline takes priority. */
  if (lexer->lookahead == '\n' &&
      (valid_symbols[TOKEN_NEWLINE] || valid_symbols[TOKEN_STMT_END])) {

    /* Guard against error-recovery mode where all symbols are valid.
       In that state, emitting _stmt_end would interfere with recovery. */
    bool error_recovery = valid_symbols[TOKEN_NEWLINE] &&
                          valid_symbols[TOKEN_BLOCK_COMMENT] &&
                          valid_symbols[TOKEN_CASE_BRACE] &&
                          valid_symbols[TOKEN_QUALIFIED_DOT] &&
                          valid_symbols[TOKEN_STMT_END];
    if (error_recovery) goto after_newline;

    /* Consume leading newlines and whitespace. */
    while (lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
           lexer->lookahead == ' ' || lexer->lookahead == '\t') {
      lexer->advance(lexer, true);
    }
    /* mark_end is set HERE (before any comments) so the token
       does NOT include comment text.  Characters advanced past mark_end
       are re-available to the parser, which creates line_comment nodes
       via the extras mechanism -- preserving highlight queries. */
    lexer->mark_end(lexer);

    /* Save position info at mark_end for _stmt_end decision. */
    uint32_t mark_col = lexer->get_column(lexer);
    int32_t mark_char = lexer->lookahead;

    /* Peek past line comments to find the next declaration start. */
    if (valid_symbols[TOKEN_NEWLINE]) {
      while (lexer->lookahead == '-') {
        lexer->advance(lexer, false);
        if (lexer->lookahead != '-') break;
        /* It's a line comment -- advance past it to peek at what follows. */
        while (lexer->lookahead != '\n' && lexer->lookahead != 0) {
          lexer->advance(lexer, false);
        }
        /* Advance past trailing whitespace after the comment. */
        while (lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
               lexer->lookahead == ' ' || lexer->lookahead == '\t') {
          lexer->advance(lexer, false);
        }
        /* Do NOT call mark_end here: comments stay outside the token. */
      }

      /* Only emit _newline when the next token is at column 0 (unindented).
         Indented continuations (column > 0) are NOT declaration boundaries.
         This mirrors the GICEL parser's atDeclBoundary() semantics. */
      if (is_decl_start_char(lexer->lookahead) &&
          lexer->get_column(lexer) == 0) {
        lexer->result_symbol = TOKEN_NEWLINE;
        return true;
      }
    }

    /* _stmt_end: newline inside a braced body at column > 0.
       Do not emit before `}` (closing delimiter is not a new statement)
       or at EOF. This mirrors GICEL's parseBody() implicit-separator
       logic: newlines at the same brace depth act as semicolons. */
    if (valid_symbols[TOKEN_STMT_END] &&
        mark_col > 0 && mark_char != '}' && !lexer->eof(lexer)) {
      lexer->result_symbol = TOKEN_STMT_END;
      return true;
    }

    /* Not a declaration boundary and not a stmt_end -- fall through.
       After consuming whitespace, the lookahead might be '{' for {- ... -}
       or for a case brace.  Returning false here would let the regular
       lexer consume '{', missing the block comment or case brace. */
  }
after_newline:

  /* -- Brace handling: case_brace and block comments ---------------------- */
  if (lexer->lookahead == '{') {
    lexer->mark_end(lexer);
    lexer->advance(lexer, false);

    if (lexer->lookahead == '-' && valid_symbols[TOKEN_BLOCK_COMMENT]) {
      /* Block comment {- ... -} */
      lexer->advance(lexer, false);
      scan_block_comment_body(lexer);
      lexer->mark_end(lexer);
      lexer->result_symbol = TOKEN_BLOCK_COMMENT;
      return true;
    }

    if (valid_symbols[TOKEN_CASE_BRACE]) {
      /* Case body brace: `{` after case scrutinee.
         The parser only sets TOKEN_CASE_BRACE as valid when it is in
         the case_expression rule after the scrutinee.  Emit the
         special token so the parser enters the case body state
         rather than the block_expression state. */
      lexer->mark_end(lexer);
      lexer->result_symbol = TOKEN_CASE_BRACE;
      return true;
    }

    /* Not a block comment and not a case brace -- return false.
       The regular lexer will re-scan from mark_end (before the `{`). */
    return false;
  }

  return false;
}
