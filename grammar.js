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
 */

/** sep1(rule, sep) — one or more rule separated by sep */
function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)));
}

module.exports = grammar({
  name: "gicel",

  externals: ($) => [
    $._newline,
    $.block_comment,
    $._open_brace,
    $._close_brace,
  ],

  extras: ($) => [/[ \t\r\n]/, $.line_comment, $.block_comment],

  word: ($) => $.identifier,

  supertypes: ($) => [$._declaration, $._expression, $._type, $._pattern],

  conflicts: ($) => [
    // class/instance head: constructor could be constraint _type or name.
    [$.class_declaration, $._type],
    [$.instance_declaration, $._type],
    [$.constraints],
    // Instance head: type_arg repeat can continue or the instance is done.
    [$.instance_declaration],
    // ADT constructor fields: repeat can continue or next | / end.
    [$.adt_constructor],
    // Instance body vs row_type: both start with { }.
    [$.instance_body, $.row_type],
    // Expression atom vs pattern in do-bind / lambda / case.
    [$._atom, $._simple_pattern],
    [$.unit_expression, $.unit_pattern],
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
        $._open_brace,
        optional(seq(sep1($.gadt_constructor, ";"), optional(";"))),
        $._close_brace,
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
        optional($.constraints),
        field("name", $.constructor),
        repeat($._type_binder),
        $._open_brace,
        optional(seq(sep1($.method_signature, ";"), optional(";"))),
        $._close_brace,
      ),

    // Constraints use plain _type before =>. Eq a is parsed as type_application.
    constraints: ($) => repeat1(seq($._type, "=>")),

    // --- instance ---

    instance_declaration: ($) =>
      seq(
        "instance",
        optional($.constraints),
        field("class", $.constructor),
        repeat($._type_arg),
        optional($.instance_body),
      ),

    instance_body: ($) =>
      seq(
        $._open_brace,
        optional(seq(sep1($.method_definition, ";"), optional(";"))),
        $._close_brace,
      ),

    method_signature: ($) =>
      seq(field("name", $.identifier), "::", field("type", $._type)),

    method_definition: ($) =>
      seq(field("name", $.identifier), ":=", field("value", $._expression)),

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

    _kind_atom: ($) => choice($.constructor, seq("(", $._kind, ")")),

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

    // Left-recursive type application: Maybe Int → type_application(Maybe, Int)
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
        $._open_brace,
        optional(
          choice(
            seq(sep1($.row_field, ","), optional(seq("|", $.identifier))),
            seq("|", $.identifier),
          ),
        ),
        $._close_brace,
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
        $._simple_expression,
      ),

    lambda_expression: ($) =>
      prec.right(
        0,
        seq("\\", field("pattern", $._pattern), "->", field("body", $._expression)),
      ),

    case_expression: ($) =>
      seq(
        "case",
        field("scrutinee", $._simple_expression),
        $._open_brace,
        optional(seq(sep1($.case_branch, ";"), optional(";"))),
        $._close_brace,
      ),

    case_branch: ($) =>
      seq(field("pattern", $._pattern), "->", field("body", $._expression)),

    do_expression: ($) =>
      seq(
        "do",
        $._open_brace,
        optional(seq(sep1($._do_statement, ";"), optional(";"))),
        $._close_brace,
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

    infix_expression: ($) =>
      prec.left(
        1,
        seq(
          $._simple_expression,
          field("operator", choice($.operator, $.backtick_operator)),
          $._simple_expression,
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
      ),

    unit_expression: ($) => prec(2, seq("(", ")")),

    parenthesized_expression: ($) =>
      seq("(", $._expression, optional(seq("::", $._type)), ")"),

    tuple_expression: ($) =>
      seq("(", $._expression, ",", sep1($._expression, ","), ")"),

    list_expression: ($) =>
      seq("[", optional(sep1($._expression, ",")), "]"),

    record_expression: ($) =>
      seq($._open_brace, sep1($.field_value, ","), $._close_brace),

    record_update_expression: ($) =>
      seq(
        $._open_brace,
        field("base", $._expression),
        "|",
        sep1($.field_value, ","),
        $._close_brace,
      ),

    field_value: ($) =>
      seq(field("label", $.identifier), "=", field("value", $._expression)),

    block_expression: ($) =>
      seq(
        $._open_brace,
        sep1(choice($.let_statement, $._expression), ";"),
        $._close_brace,
      ),

    projection_expression: ($) =>
      prec.left(20, seq($._atom, "!#", field("field", $.identifier))),

    type_application_expression: ($) =>
      prec(15, seq($._atom, "@", $._type_arg)),

    // ════════════════════════════════════════════════════════════════════
    //  Patterns
    // ════════════════════════════════════════════════════════════════════

    _pattern: ($) => choice($.constructor_pattern, $._simple_pattern),

    constructor_pattern: ($) =>
      prec(1, seq($.constructor, repeat1($._simple_pattern))),

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
        $._open_brace,
        sep1($.field_pattern, ","),
        optional(seq("|", $.wildcard)),
        $._close_brace,
      ),

    field_pattern: ($) =>
      seq(field("label", $.identifier), "=", field("value", $._pattern)),

    // ════════════════════════════════════════════════════════════════════
    //  Terminals
    // ════════════════════════════════════════════════════════════════════

    identifier: (_) => /[a-z][a-zA-Z0-9_']*|_[a-zA-Z0-9_']+/,
    constructor: (_) => /[A-Z][a-zA-Z0-9_']*/,
    operator: (_) => /[!#$%&*+\-/<=>?^~|:.]+/,
    integer: (_) => /[0-9]+/,
    wildcard: (_) => "_",

    string: ($) =>
      seq('"', repeat(choice($.escape_sequence, /[^"\\]+/)), '"'),

    rune: ($) => seq("'", choice($.escape_sequence, /[^'\\]/), "'"),

    escape_sequence: (_) => /\\[ntr\\"'0]/,

    line_comment: (_) => token(seq("--", /[^\n]*/)),
  },
});
