/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * Tree-sitter grammar for GICEL (Go's Indexed Capability Effect Language).
 *
 * Unified syntax (post-migration):
 *   - `data` covers ADTs, GADTs, and type classes.
 *   - `type` covers type aliases and type families.
 *   - `impl` replaces `instance` for type class instances.
 *   - Case alternatives use `=>` (not `->`, which is function arrow).
 *   - `=>` in expressions: evidence injection (`value => expr`).
 *   - Row field grade annotation: `GradeExpr => Type` (not `@Type`).
 *   - GADT/class member type signatures use `:` (not `::`).
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
  //
  // _qualified_dot is emitted when `.` appears with no whitespace
  // on either side (adjacent to both preceding constructor and
  // following identifier). This mirrors GICEL's tokensAdjacent()
  // semantics for qualified references: M.x vs M . x (composition).
  externals: ($) => [
    $._newline,
    $.block_comment,
    $._case_brace,
    $._qualified_dot,
  ],

  extras: ($) => [/[ \t\r\n]/, $.line_comment, $.block_comment],

  word: ($) => $.identifier,

  supertypes: ($) => [$._declaration, $._expression, $._type, $._pattern],

  inline: ($) => [$._no_brace_atom, $._scrutinee_app_or_atom],

  conflicts: ($) => [
    // constraint arg overlaps with type_arg.
    [$._constraint_arg, $._type_arg],
    // ADT constructor fields: repeat can continue or next | / end.
    [$.adt_constructor],
    // ADT constructor vs constraint head in data_brace_body:
    // `data Name := Con (` could be ADT constructor field or constraint arg.
    [$.adt_constructor, $._constraint_head],
    // Expression atom vs pattern in do-bind / lambda / case.
    [$._atom, $._simple_pattern],
    [$._atom, $.constructor_pattern],
    [$.unit_expression, $.unit_pattern],
    // Left operator section vs infix: after `( app-or-atom`, seeing `op`
    // could reduce to _simple_expression (for infix) or continue left_section.
    [$._simple_expression, $.left_section],
    // Lambda/do/case as atom: these appear in both _expression and _atom.
    [$._expression, $._atom],
    // List expression vs list pattern in ambiguous contexts (e.g., do-bind).
    [$.list_expression, $.list_pattern],
    // type_case vs row_type: `case Type { }` — `{}` could be
    // row_type (argument to case scrutinee) or empty type_case body.
    [$.type_case, $.row_type],
    // Parenthesized operator vs operator section: `(.)` in impl body
    // could be method name or operator section.
    [$.parenthesized_operator, $._section_op],
    // impl body vs block_expression: `{ id := expr; ... }` could
    // be method_definition (in impl_body) or let_statement (in block_expression).
    [$.method_definition, $.let_statement],
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
        $.type_declaration,
        $.fixity_declaration,
        $.impl_declaration,
        $.type_annotation,
        $.value_definition,
      ),

    // ════════════════════════════════════════════════════════════════════
    //  Declarations
    // ════════════════════════════════════════════════════════════════════

    // prec.right: after `import ModuleName`, prefer consuming `as`/`(`
    // as part of this declaration rather than starting a new one.
    import_declaration: ($) =>
      prec.right(seq(
        "import",
        $.module_name,
        optional(choice($.import_alias, $.import_list)),
      )),

    import_alias: ($) => seq("as", field("alias", $.constructor)),

    import_list: ($) =>
      seq("(", sep1($.import_item, ","), ")"),

    import_item: ($) =>
      choice(
        $.identifier,
        $.parenthesized_operator,
        seq($.constructor, optional($.import_members)),
      ),

    import_members: ($) =>
      seq(
        "(",
        choice(
          "..",
          sep1($.constructor, ","),
        ),
        ")",
      ),

    module_name: ($) => sep1($.constructor, "."),

    // --- data (unified: ADT, GADT, type class) ---
    //
    // ADT shorthand:  data Name params := Con1 | Con2 fields
    // GADT body:      data Name := \params. { Con: Type; ... }
    // Type class:     data Name := \params. [Constraint =>] { method: Type; ... }
    //
    // The GADT body and type class body are distinguished by member
    // content (gadt_constructor uses uppercase : type, method_signature
    // uses lowercase : type). Both share the brace-delimited body form.

    data_declaration: ($) =>
      seq(
        "data",
        field("name", $.constructor),
        repeat($._type_binder),
        ":=",
        field("body", $._data_body),
      ),

    _data_body: ($) =>
      choice(
        $.adt_constructors,
        $.data_brace_body,
      ),

    adt_constructors: ($) => sep1($.adt_constructor, "|"),

    adt_constructor: ($) =>
      seq(field("name", $.constructor), repeat($._type_arg)),

    // Brace body: covers GADT constructors AND type class members.
    // Optionally preceded by `\params.` and/or `Constraint =>`.
    // Examples:
    //   data Expr := \a. { LitInt: Int -> Expr Int; ... }
    //   data Eq := \a. { eq: a -> a -> Bool }
    //   data Ord := \a. Eq a => { compare: a -> a -> Ordering }
    data_brace_body: ($) =>
      seq(
        optional(seq("\\", repeat1($._type_binder), ".")),
        repeat($.constraint),
        "{",
        optional(seq(sep1($._data_member, ";"), optional(";"))),
        "}",
      ),

    _data_member: ($) =>
      choice(
        $.gadt_constructor,
        $.method_signature,
        $.assoc_type_signature,
        $.assoc_data_signature,
      ),

    // GADT constructor: uppercase name with `:` type signature.
    gadt_constructor: ($) =>
      seq(field("name", $.constructor), ":", field("type", $._type)),

    // --- type (unified: alias and family) ---
    //
    // Type alias:  type Name params := TypeExpr
    // Type family: type Name :: Kind := \params. case param { Pat => Type; ... }
    //
    // Distinguished by `::` after the name (family) vs no `::` (alias).

    type_declaration: ($) =>
      choice(
        $.type_alias,
        $.type_family,
      ),

    type_alias: ($) =>
      seq(
        "type",
        field("name", $.constructor),
        repeat($._type_binder),
        ":=",
        field("type", $._type),
      ),

    // type Name :: Kind := \params. case param { Pat => Type; ... }
    type_family: ($) =>
      seq(
        "type",
        field("name", $.constructor),
        "::",
        field("result", $._kind),
        ":=",
        field("body", $._type),
      ),

    // --- fixity ---

    fixity_declaration: ($) =>
      seq(
        field("fixity", choice("infixl", "infixr", "infixn")),
        field("precedence", $.integer),
        field("operator", choice($.operator, $.identifier, alias(".", $.operator))),
      ),

    // --- impl (replaces instance) ---
    //
    // impl [Constraint =>] ClassName TypeArg* := { ... }
    // impl _name :: [Constraint =>] ClassName TypeArg* := Expr

    impl_declaration: ($) =>
      seq(
        "impl",
        optional($.impl_name),
        repeat($.constraint),
        field("class", $.constructor),
        repeat($._type_arg),
        ":=",
        field("body", choice($.impl_body, $._expression)),
      ),

    // Private/named instance: `_name ::`
    impl_name: ($) =>
      seq(field("name", $.identifier), "::"),

    impl_body: ($) =>
      seq(
        "{",
        optional(seq(sep1($._impl_member, ";"), optional(";"))),
        "}",
      ),

    _impl_member: ($) =>
      choice(
        $.method_definition,
        $.assoc_type_definition,
        $.assoc_data_definition,
      ),

    // type Name := TypeExpr (in impl body)
    assoc_type_definition: ($) =>
      seq("type", field("name", $.constructor), ":=", field("rhs", $._type)),

    // data Name := Con fields | Con fields (in impl body)
    assoc_data_definition: ($) =>
      seq("data", field("name", $.constructor), ":=", $.adt_constructors),

    // Associated type signature in class body: type Name params :: Kind
    assoc_type_signature: ($) =>
      seq("type", field("name", $.constructor), repeat($._type_binder), "::", $._kind),

    // Associated data signature in class body: data Name params :: Kind
    assoc_data_signature: ($) =>
      seq("data", field("name", $.constructor), repeat($._type_binder), "::", $._kind),

    // Constraint: ClassName arg1 arg2 ... =>
    constraint: ($) =>
      seq($._constraint_head, "=>"),

    _constraint_head: ($) =>
      choice(
        seq($.constructor, repeat($._constraint_arg)),
        seq("(", sep1(seq($.constructor, repeat($._constraint_arg)), ","), ")"),
      ),

    _constraint_arg: ($) =>
      choice(
        $.identifier,
        $.constructor,
        $.qualified_type_constructor,
        $.unit_type,
        $.parenthesized_type,
        $.tuple_type,
        $.row_type,
      ),

    // Method signature in class body: name : Type (uses `:` not `::`)
    method_signature: ($) =>
      seq(field("name", choice($.identifier, $.parenthesized_operator)), ":", field("type", $._type)),

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

    parenthesized_operator: ($) => seq("(", choice($.operator, alias(".", $.operator)), ")"),

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
        $.type_case,
        // Atoms directly in supertype:
        $.identifier,
        $.constructor,
        $.qualified_type_constructor,
        $.unit_type,
        $.parenthesized_type,
        $.tuple_type,
        $.row_type,
      ),

    forall_type: ($) => seq("\\", repeat1($._type_binder), ".", $._type),

    // Constraint is just _type before =>. Eq a parses as type_application(Eq, a).
    qualified_type: ($) => prec.right(1, seq($._type, "=>", $._type)),

    // Left-recursive type application: Maybe Int -> type_application(Maybe, Int)
    type_application: ($) =>
      prec.left(10, seq(
        field("constructor", $._type),
        field("argument", $._type),
      )),

    function_type: ($) => prec.right(2, seq($._type, "->", $._type)),

    // Type-level case expression (used in type families).
    // `case scrutinee { Pattern => Type; ... }`
    type_case: ($) =>
      seq(
        "case",
        field("scrutinee", $._type),
        "{",
        optional(seq(sep1($.type_case_branch, ";"), optional(";"))),
        "}",
      ),

    type_case_branch: ($) =>
      seq(field("pattern", $._type), "=>", field("body", $._type)),

    // Qualified type constructor: M.Type (adjacency-sensitive, via external scanner).
    qualified_type_constructor: ($) =>
      seq(
        field("module", $.constructor),
        $._qualified_dot,
        field("name", alias(token.immediate(/[A-Z][a-zA-Z0-9_']*/), $.constructor)),
      ),

    // Type arguments for ADT constructors and instance heads.
    // These are "atomic" types only (not application/function/qualified).
    _type_arg: ($) =>
      choice(
        $.identifier,
        $.constructor,
        $.qualified_type_constructor,
        $.wildcard,
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

    // Row field: label : Type
    // Grade annotations parse as qualified_type within the type position:
    //   `h: Linear => Handle`  ->  row_field(h, qualified_type(Linear, Handle))
    // This matches the surface syntax where grade annotations use `=>`.
    row_field: ($) =>
      seq(field("label", $.identifier), ":", field("type", $._type)),

    // ════════════════════════════════════════════════════════════════════
    //  Expressions
    // ════════════════════════════════════════════════════════════════════

    _expression: ($) =>
      choice(
        $.lambda_expression,
        $.case_expression,
        $.do_expression,
        $.type_annotated_expression,
        $.evidence_injection,
        $._simple_expression,
      ),

    // Bare expression-level type annotation: `expr :: Type`
    // Lowest precedence among expressions (below infix).
    type_annotated_expression: ($) =>
      prec.right(-1, seq($._simple_expression, "::", $._type)),

    // Evidence injection: `value => expr`
    // Right-associative, binds below annotation (::) and above nothing.
    // Uses prec -1 (same as type_annotated_expression) — both are
    // lowest-precedence expression forms. Ambiguity with type annotation
    // is resolved by the separator token (=> vs ::).
    evidence_injection: ($) =>
      prec.right(-1, seq($._simple_expression, "=>", $._expression)),

    lambda_expression: ($) =>
      prec.right(
        0,
        seq("\\", repeat1(field("pattern", $._simple_pattern)), ".", field("body", $._expression)),
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
          field("operator", choice($.operator, $.backtick_operator, alias(".", $.operator))),
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
        $.qualified_variable,
        $.qualified_constructor,
        $.integer,
        $.double,
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
        $.lambda_expression,
        $.do_expression,
        $.case_expression,
      ),

    // Case alternatives use `=>` (not `->`).
    case_branch: ($) =>
      seq(field("pattern", $._pattern), "=>", field("body", $._expression)),

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
          field("operator", choice($.operator, $.backtick_operator, alias(".", $.operator))),
          $._expression,
        ),
      ),

    backtick_operator: ($) => seq("`", $.identifier, "`"),

    _application_or_atom: ($) => choice($.application, $._atom),

    application: ($) =>
      prec.left(10, seq($._application_or_atom, $._atom)),

    // Qualified references: M.x (variable), M.Just (constructor).
    // Adjacency-sensitive via _qualified_dot (external scanner).
    qualified_variable: ($) =>
      seq(
        field("module", $.constructor),
        $._qualified_dot,
        field("name", alias(token.immediate(/[a-z][a-zA-Z0-9_']*/), $.identifier)),
      ),

    qualified_constructor: ($) =>
      seq(
        field("module", $.constructor),
        $._qualified_dot,
        field("name", alias(token.immediate(/[A-Z][a-zA-Z0-9_']*/), $.constructor)),
      ),

    _atom: ($) =>
      choice(
        $.identifier,
        $.constructor,
        $.qualified_variable,
        $.qualified_constructor,
        $.integer,
        $.double,
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
        $.lambda_expression,
        $.do_expression,
        $.case_expression,
      ),

    unit_expression: ($) => prec(2, seq("(", ")")),

    parenthesized_expression: ($) =>
      seq("(", $._expression, optional(seq("::", $._type)), ")"),

    // Operator sections — expression-level counterpart of (op) in declarations.
    // (op)      -> operator as first-class value
    // (op expr) -> right section: \x. x op expr
    // (expr op) -> left section:  \x. expr op x
    //
    // _section_op includes `.` (infixr 9, function composition) which is
    // excluded from the operator regex to avoid conflicts with quantifier/lambda/module
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
      seq(field("label", $.identifier), ":", field("value", $._expression)),

    block_expression: ($) =>
      prec(-1, seq(
        "{",
        repeat(seq($.let_statement, ";")),
        $._expression,
        "}",
      )),

    projection_expression: ($) =>
      prec.left(20, seq($._atom, ".#", field("field", $.identifier))),

    type_application_expression: ($) =>
      prec(15, seq($._atom, "@", $._type_arg)),

    // ════════════════════════════════════════════════════════════════════
    //  Patterns
    // ════════════════════════════════════════════════════════════════════

    _pattern: ($) => choice($.constructor_pattern, $._simple_pattern),

    constructor_pattern: ($) =>
      seq(choice($.constructor, $.qualified_constructor), repeat1($._simple_pattern)),

    _simple_pattern: ($) =>
      choice(
        $.identifier,
        $.wildcard,
        $.constructor,
        $.qualified_constructor,
        $.integer,
        $.double,
        $.string,
        $.rune,
        $.unit_pattern,
        $.parenthesized_pattern,
        $.tuple_pattern,
        $.record_pattern,
        $.list_pattern,
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
      seq(field("label", $.identifier), ":", field("value", $._pattern)),

    list_pattern: ($) =>
      seq("[", optional(sep1($._pattern, ",")), "]"),

    // ════════════════════════════════════════════════════════════════════
    //  Terminals
    // ════════════════════════════════════════════════════════════════════

    identifier: (_) => /[a-z][a-zA-Z0-9_']*|_[a-zA-Z0-9_']+/,
    constructor: (_) => /[A-Z][a-zA-Z0-9_']*/,
    // `:` and `.` are handled specially by the lexer (type annotations,
    // quantifier/lambda body separator, etc.) and must not appear in operator tokens.
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
    integer: (_) => /[0-9](_?[0-9])*/,

    // Double literal: decimal point and/or exponent, with optional underscore separators.
    // Matches: 3.14, 1e10, 1.05e+10, 2_000.5e-3
    // The decimal-point form requires a digit after `.` to avoid ambiguity with
    // the composition operator (infixr 9).
    double: (_) => token(choice(
      /[0-9](_?[0-9])*\.[0-9](_?[0-9])*([eE][+-]?[0-9](_?[0-9])*)?/,
      /[0-9](_?[0-9])*[eE][+-]?[0-9](_?[0-9])*/,
    )),

    wildcard: (_) => "_",

    string: ($) =>
      seq('"', repeat(choice($.escape_sequence, /[^"\\]+/)), '"'),

    rune: ($) => seq("'", choice($.escape_sequence, /[^'\\]/), "'"),

    escape_sequence: (_) => /\\[ntr\\"'0]/,

    line_comment: (_) => token(seq("--", /[^\n]*/)),
  },
});
