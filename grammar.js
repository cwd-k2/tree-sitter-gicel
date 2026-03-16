/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * Tree-sitter grammar for GICEL (Go's Indexed Capability Effect Language).
 *
 * Design principles (from tree-sitter-haskell pattern):
 *   - _type is a flat supertype: all type forms are direct alternatives.
 *   - type_application is left-recursive through _type with prec.left(10).
 *   - Constraints before => are plain _type (no separate constraint grammar).
 *   - Precedence resolves ambiguity: application(10) > function(2) > qualified(1).
 *   - External scanner handles brace depth, _newline, and block comments.
 *   - _case_brace: external token for `{` in case_expression, avoiding
 *     LALR shift-reduce conflict between case body and block_expression.
 */

/** sep1(rule, sep) — one or more rule separated by sep */
function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)));
}

module.exports = grammar({
  name: "gicel",

  // _newline is emitted by the external scanner only at column 0
  // (declaration boundary). At column > 0, the scanner returns false
  // and the \n in extras handles the newline silently. This mirrors
  // GICEL's atDeclBoundary() semantics.
  //
  // _case_brace is emitted by the external scanner when `{` appears
  // and the parser expects it (case_expression body). This prevents
  // LALR state merging that would otherwise conflate the case body
  // `{` with the block_expression/record_expression `{`.
  externals: ($) => [
    $._newline,
    $.block_comment,
    $._case_brace,
  ],

  extras: ($) => [/[ \t\r\n]/, $.line_comment, $.block_comment],

  word: ($) => $.identifier,

  supertypes: ($) => [$._declaration, $._expression, $._type, $._pattern],

  inline: ($) => [$._no_brace_atom, $._scrutinee_app_or_atom],

  conflicts: ($) => [
    // class/instance constraint vs class/instance name (both start with constructor).
    [$._constraint_head, $.instance_declaration],
    // constraint arg overlaps with type_binder and type_arg.
    [$._constraint_arg, $._type_binder],
    [$._constraint_arg, $._type_arg],
    // Instance head: type_arg repeat can continue or instance is done.
    [$.instance_declaration],
    // ADT constructor fields: repeat can continue or next | / end.
    [$.adt_constructor],
    // Instance body vs row_type: both start with {.
    [$.instance_body, $.row_type],
    // Class/instance body vs row_type in constraint args.
    [$.class_declaration, $.row_type],
    // Expression atom vs pattern in do-bind / lambda / case.
    [$._atom, $._simple_pattern],
    [$._atom, $.constructor_pattern],
    [$.unit_expression, $.unit_pattern],
    // Left operator section vs infix: after `( app-or-atom`, seeing `op`
    // could reduce to _simple_expression (for infix) or continue left_section.
    [$._simple_expression, $.left_section],
  ],

  rules: {
    // ════════════════════════════════════════════════════════════════════
    //  Top level
    // ════════════════════════════════════════════════════════════════════

    source_file: ($) => repeat(choice($._declaration, $._newline, ";")),

    _declaration: ($) =>
      choice(
        $.import_declaration,
        $.data_declaration,
        $.type_alias_declaration,
        $.fixity_declaration,
        $.class_declaration,
        $.instance_declaration,
        $.type_annotation,
        $.value_definition,
      ),

    // ════════════════════════════════════════════════════════════════════
    //  Declarations
    // ════════════════════════════════════════════════════════════════════

    import_declaration: ($) => seq("import", $.module_name),

    module_name: ($) => sep1($.constructor, "."),

    // --- data ---

    data_declaration: ($) =>
      seq(
        "data",
        field("name", $.constructor),
        repeat($._type_binder),
        "=",
        choice($.adt_constructors, $.gadt_body),
      ),

    adt_constructors: ($) => sep1($.adt_constructor, "|"),

    adt_constructor: ($) =>
      seq(field("name", $.constructor), repeat($._type_arg)),

    gadt_body: ($) =>
      seq(
        "{",
        optional(seq(sep1($.gadt_constructor, ";"), optional(";"))),
        "}",
      ),

    gadt_constructor: ($) =>
      seq(field("name", $.constructor), "::", field("type", $._type)),

    // --- type ---

    type_alias_declaration: ($) =>
      seq(
        "type",
        field("name", $.constructor),
        repeat($._type_binder),
        "=",
        field("type", $._type),
      ),

    // --- fixity ---

    fixity_declaration: ($) =>
      seq(
        field("fixity", choice("infixl", "infixr", "infixn")),
        field("precedence", $.integer),
        field("operator", choice($.operator, $.identifier)),
      ),

    // --- class ---

    class_declaration: ($) =>
      seq(
        "class",
        repeat($.constraint),
        field("name", $.constructor),
        repeat($._type_binder),
        "{",
        optional(seq(sep1($.method_signature, ";"), optional(";"))),
        "}",
      ),

    // Constraint: ClassName arg1 arg2 ... =>
    constraint: ($) =>
      seq($._constraint_head, "=>"),

    _constraint_head: ($) =>
      choice(
        seq($.constructor, repeat($._constraint_arg)),
        seq("(", $.constructor, repeat($._constraint_arg), ")"),
      ),

    _constraint_arg: ($) =>
      choice(
        $.identifier,
        $.constructor,
        $.unit_type,
        $.parenthesized_type,
        $.tuple_type,
        $.row_type,
      ),

    // --- instance ---

    instance_declaration: ($) =>
      seq(
        "instance",
        repeat($.constraint),
        field("class", $.constructor),
        repeat($._type_arg),
        optional($.instance_body),
      ),

    instance_body: ($) =>
      seq(
        "{",
        optional(seq(sep1($.method_definition, ";"), optional(";"))),
        "}",
      ),

    method_signature: ($) =>
      seq(field("name", choice($.identifier, $.parenthesized_operator)), "::", field("type", $._type)),

    method_definition: ($) =>
      seq(field("name", choice($.identifier, $.parenthesized_operator)), ":=", field("value", $._expression)),

    // --- type annotation / value definition ---

    type_annotation: ($) =>
      seq(
        field("name", choice($.identifier, $.parenthesized_operator)),
        "::",
        field("type", $._type),
      ),

    value_definition: ($) =>
      seq(
        field("name", choice($.identifier, $.parenthesized_operator)),
        ":=",
        field("value", $._expression),
      ),

    parenthesized_operator: ($) => seq("(", $.operator, ")"),

    // ════════════════════════════════════════════════════════════════════
    //  Type binders & kinds
    // ════════════════════════════════════════════════════════════════════

    _type_binder: ($) => choice($.identifier, $.kinded_variable),

    kinded_variable: ($) =>
      seq("(", field("name", $.identifier), ":", field("kind", $._kind), ")"),

    _kind: ($) => choice($.kind_arrow, $._kind_atom),

    kind_arrow: ($) => prec.right(1, seq($._kind_atom, "->", $._kind)),

    _kind_atom: ($) => choice($.constructor, $.identifier, seq("(", $._kind, ")")),

    // ════════════════════════════════════════════════════════════════════
    //  Type expressions
    //
    //  Flat supertype: all type forms at one level. Left-recursive
    //  type_application resolved by prec.left(10). No separate _type_atom.
    // ════════════════════════════════════════════════════════════════════

    _type: ($) =>
      choice(
        $.forall_type,
        $.qualified_type,
        $.function_type,
        $.type_application,
        // Atoms directly in supertype:
        $.identifier,
        $.constructor,
        $.unit_type,
        $.parenthesized_type,
        $.tuple_type,
        $.row_type,
      ),

    forall_type: ($) => seq("forall", repeat1($._type_binder), ".", $._type),

    // Constraint is just _type before =>. Eq a parses as type_application(Eq, a).
    qualified_type: ($) => prec.right(1, seq($._type, "=>", $._type)),

    // Left-recursive type application: Maybe Int -> type_application(Maybe, Int)
    type_application: ($) =>
      prec.left(10, seq(
        field("constructor", $._type),
        field("argument", $._type),
      )),

    function_type: ($) => prec.right(2, seq($._type, "->", $._type)),

    // Type arguments for ADT constructors and instance heads.
    // These are "atomic" types only (not application/function/qualified).
    _type_arg: ($) =>
      choice(
        $.identifier,
        $.constructor,
        $.unit_type,
        $.parenthesized_type,
        $.tuple_type,
        $.row_type,
      ),

    unit_type: ($) => prec(2, seq("(", ")")),

    parenthesized_type: ($) => seq("(", $._type, ")"),

    tuple_type: ($) => seq("(", $._type, ",", sep1($._type, ","), ")"),

    row_type: ($) =>
      seq(
        "{",
        optional(
          choice(
            seq(sep1($.row_field, ","), optional(seq("|", $.identifier))),
            seq("|", $.identifier),
          ),
        ),
        "}",
      ),

    row_field: ($) => seq(field("label", $.identifier), ":", $._type),

    // ════════════════════════════════════════════════════════════════════
    //  Expressions
    // ════════════════════════════════════════════════════════════════════

    _expression: ($) =>
      choice(
        $.lambda_expression,
        $.case_expression,
        $.do_expression,
        $.type_annotated_expression,
        $._simple_expression,
      ),

    // Bare expression-level type annotation: `expr :: Type`
    // Lowest precedence among expressions (below infix).
    type_annotated_expression: ($) =>
      prec.right(-1, seq($._simple_expression, "::", $._type)),

    lambda_expression: ($) =>
      prec.right(
        0,
        seq("\\", field("pattern", $._pattern), "->", field("body", $._expression)),
      ),

    // case_expression uses _case_brace (external token) instead of "{".
    // This avoids the LALR shift-reduce conflict where application's
    // prec.left(10) would consume `{` as a block_expression atom,
    // preventing the scrutinee from reducing.
    case_expression: ($) =>
      seq(
        "case",
        field("scrutinee", $._scrutinee),
        $._case_brace,
        optional(seq(sep1($.case_branch, ";"), optional(";"))),
        "}",
      ),

    // Scrutinee: like _simple_expression but atoms cannot start with {.
    // Mirrors GICEL parser's noBraceAtom flag.
    _scrutinee: ($) =>
      choice(
        alias($._scrutinee_infix, $.infix_expression),
        $._scrutinee_app_or_atom,
      ),

    // Flat precedence: see comment on infix_expression. CST consumers
    // must re-bracket based on fixity declarations.
    _scrutinee_infix: ($) =>
      prec.left(
        1,
        seq(
          $._scrutinee,
          field("operator", choice($.operator, $.backtick_operator)),
          $._expression,
        ),
      ),

    _scrutinee_app_or_atom: ($) =>
      choice(alias($._scrutinee_app, $.application), $._no_brace_atom),

    _scrutinee_app: ($) =>
      prec.left(10, seq($._scrutinee_app_or_atom, $._no_brace_atom)),

    _no_brace_atom: ($) =>
      choice(
        $.identifier,
        $.constructor,
        $.integer,
        $.string,
        $.rune,
        $.unit_expression,
        $.parenthesized_expression,
        $.tuple_expression,
        $.list_expression,
        $.projection_expression,
        $.type_application_expression,
        $.operator_section,
        $.right_section,
        $.left_section,
      ),

    case_branch: ($) =>
      seq(field("pattern", $._pattern), "->", field("body", $._expression)),

    do_expression: ($) =>
      seq(
        "do",
        "{",
        optional(seq(sep1($._do_statement, ";"), optional(";"))),
        "}",
      ),

    _do_statement: ($) =>
      choice($.bind_statement, $.let_statement, $._expression),

    bind_statement: ($) =>
      seq(field("pattern", $._pattern), "<-", field("value", $._expression)),

    let_statement: ($) =>
      seq(
        field("name", $.identifier),
        ":=",
        field("value", $._expression),
      ),

    _simple_expression: ($) =>
      choice($.infix_expression, $._application_or_atom),

    // All operators share prec.left(1): GICEL uses user-defined fixity
    // declarations (infixl/infixr/infixn) that cannot be encoded in
    // tree-sitter's static precedence system. CST consumers must
    // re-bracket infix chains based on fixity declarations.
    infix_expression: ($) =>
      prec.left(
        1,
        seq(
          $._simple_expression,
          field("operator", choice($.operator, $.backtick_operator)),
          $._expression,
        ),
      ),

    backtick_operator: ($) => seq("`", $.identifier, "`"),

    _application_or_atom: ($) => choice($.application, $._atom),

    application: ($) =>
      prec.left(10, seq($._application_or_atom, $._atom)),

    _atom: ($) =>
      choice(
        $.identifier,
        $.constructor,
        $.integer,
        $.string,
        $.rune,
        $.unit_expression,
        $.parenthesized_expression,
        $.tuple_expression,
        $.list_expression,
        $.record_expression,
        $.record_update_expression,
        $.block_expression,
        $.projection_expression,
        $.type_application_expression,
        $.operator_section,
        $.right_section,
        $.left_section,
      ),

    unit_expression: ($) => prec(2, seq("(", ")")),

    parenthesized_expression: ($) =>
      seq("(", $._expression, optional(seq("::", $._type)), ")"),

    // Operator sections — expression-level counterpart of (op) in declarations.
    // (op)      → operator as first-class value
    // (op expr) → right section: \x -> x op expr
    // (expr op) → left section:  \x -> expr op x
    //
    // _section_op includes `.` (infixr 9, function composition) which is
    // excluded from the operator regex to avoid conflicts with forall/module
    // separators, but is valid in section position.

    _section_op: ($) => choice($.operator, alias(".", $.operator)),

    operator_section: ($) =>
      seq("(", field("operator", $._section_op), ")"),

    right_section: ($) =>
      seq(
        "(",
        field("operator", $._section_op),
        field("operand", $._expression),
        ")",
      ),

    left_section: ($) =>
      seq(
        "(",
        field("operand", $._application_or_atom),
        field("operator", $._section_op),
        ")",
      ),

    tuple_expression: ($) =>
      seq("(", $._expression, ",", sep1($._expression, ","), ")"),

    list_expression: ($) =>
      seq("[", optional(sep1($._expression, ",")), "]"),

    record_expression: ($) =>
      prec(-1, seq("{", sep1($.field_value, ","), "}")),

    record_update_expression: ($) =>
      prec(-1, seq(
        "{",
        field("base", $._expression),
        "|",
        sep1($.field_value, ","),
        "}",
      )),

    field_value: ($) =>
      seq(field("label", $.identifier), "=", field("value", $._expression)),

    block_expression: ($) =>
      prec(-1, seq(
        "{",
        repeat(seq($.let_statement, ";")),
        $._expression,
        "}",
      )),

    projection_expression: ($) =>
      prec.left(20, seq($._atom, "!#", field("field", $.identifier))),

    type_application_expression: ($) =>
      prec(15, seq($._atom, "@", $._type_arg)),

    // ════════════════════════════════════════════════════════════════════
    //  Patterns
    // ════════════════════════════════════════════════════════════════════

    _pattern: ($) => choice($.constructor_pattern, $._simple_pattern),

    constructor_pattern: ($) =>
      seq($.constructor, repeat1($._simple_pattern)),

    _simple_pattern: ($) =>
      choice(
        $.identifier,
        $.wildcard,
        $.constructor,
        $.integer,
        $.string,
        $.rune,
        $.unit_pattern,
        $.parenthesized_pattern,
        $.tuple_pattern,
        $.record_pattern,
      ),

    unit_pattern: ($) => prec(2, seq("(", ")")),

    parenthesized_pattern: ($) => seq("(", $._pattern, ")"),

    tuple_pattern: ($) =>
      seq("(", $._pattern, ",", sep1($._pattern, ","), ")"),

    record_pattern: ($) =>
      seq(
        "{",
        sep1($.field_pattern, ","),
        optional(seq("|", $.wildcard)),
        "}",
      ),

    field_pattern: ($) =>
      seq(field("label", $.identifier), "=", field("value", $._pattern)),

    // ════════════════════════════════════════════════════════════════════
    //  Terminals
    // ════════════════════════════════════════════════════════════════════

    identifier: (_) => /[a-z][a-zA-Z0-9_']*|_[a-zA-Z0-9_']+/,
    constructor: (_) => /[A-Z][a-zA-Z0-9_']*/,
    // `:` and `.` are handled specially by the lexer (type annotations,
    // forall body separator, etc.) and must not appear in operator tokens.
    // `->` and `<-` are reserved and excluded from the operator regex
    // so they are always lexed as keyword tokens, never as operators.
    // The regex handles three cases:
    //   - 3+ operator chars (cannot be just -> or <-)
    //   - 2 operator chars that are NOT -> or <-
    //   - 1 operator char
    operator: (_) => {
      const op = /[!#$%&*+\-/<=>?^~|]/;
      return token(choice(
        // 3 or more operator characters — always valid
        seq(op, op, op, repeat(op)),
        // 2 operator characters, excluding -> and <-:
        //   first is NOT - and NOT <: anything goes for second
        seq(/[!#$%&*+/=>?^~|]/, op),
        //   first IS -, second is NOT >
        seq("-", /[!#$%&*+\-/<=?^~|]/),
        //   first IS <, second is NOT -
        seq("<", /[!#$%&*+/<=>?^~|]/),
        // single operator character
        op,
      ));
    },
    integer: (_) => /[0-9]+/,
    wildcard: (_) => "_",

    string: ($) =>
      seq('"', repeat(choice($.escape_sequence, /[^"\\]+/)), '"'),

    rune: ($) => seq("'", choice($.escape_sequence, /[^'\\]/), "'"),

    escape_sequence: (_) => /\\[ntr\\"'0]/,

    line_comment: (_) => token(seq("--", /[^\n]*/)),
  },
});
