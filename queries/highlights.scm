; GICEL highlight queries for tree-sitter (unified syntax)

; ── Keywords ────────────────────────────────────────────────────────
[
  "case"
  "form"
  "lazy"
  "do"
  "type"
  "impl"
  "import"
  "infixl"
  "infixr"
  "infixn"
  "if"
  "then"
  "else"
] @keyword

; ── Built-in identifiers ───────────────────────────────────────────
((identifier) @function.builtin
  (#any-of? @function.builtin
    "pure" "bind" "thunk" "force" "assumption" "rec" "fix"))

; ── Declarations ───────────────────────────────────────────────────
(form_declaration name: (constructor) @type.definition)
(type_alias name: (constructor) @type.definition)
(type_family name: (constructor) @type.definition)
(impl_declaration class: (constructor) @type)

(type_annotation name: (identifier) @function)
(type_annotation name: (parenthesized_operator (operator) @function))
(value_definition name: (identifier) @function)
(value_definition name: (parenthesized_operator (operator) @function))

(method_signature name: (identifier) @function.method)
(method_signature name: (parenthesized_operator (operator) @function.method))
(method_definition name: (identifier) @function.method)
(method_definition name: (parenthesized_operator (operator) @function.method))

(adt_constructor name: (constructor) @constructor)
(gadt_constructor name: (constructor) @constructor)

(fixity_declaration precedence: (integer) @number)
(fixity_declaration operator: (operator) @operator)
(fixity_declaration operator: (identifier) @function)

; ── Associated types ─────────────────────────────────────────────
(assoc_type_signature name: (constructor) @type.definition)
(assoc_data_signature name: (constructor) @type.definition)
(assoc_type_definition name: (constructor) @type)
(assoc_form_definition name: (constructor) @type.definition)

; ── Impl name (private instance) ─────────────────────────────────
(impl_name name: (identifier) @function)

; ── Imports ─────────────────────────────────────────────────────────
(import_declaration (module_name (constructor) @module))

; ── Types ──────────────────────────────────────────────────────────
(forall_type "\\" @keyword)
(forall_type (identifier) @type)
(kinded_variable name: (identifier) @type)
(type_application constructor: (constructor) @type)
(row_field label: (identifier) @property)

; Constraint before =>: highlight the constructor as a type class
(qualified_type (type_application constructor: (constructor) @type))
(qualified_type (constructor) @type)
(constraint (constructor) @type)

; ── Expressions ────────────────────────────────────────────────────
(lambda_expression "\\" @keyword.function)

(infix_expression operator: (operator) @operator)
(backtick_operator (identifier) @function)

(bind_statement "<-" @keyword.operator)
(let_statement ":=" @keyword.operator)

(type_annotated_expression "::" @punctuation.special)
(evidence_injection "=>" @keyword.operator)

(field_value label: (identifier) @property)
(projection_expression ".#" @operator)
(projection_expression field: (identifier) @property)
(type_application_expression "@" @operator)

; ── Operator sections ─────────────────────────────────────────────
(operator_section operator: (operator) @operator)
(right_section operator: (operator) @operator)
(left_section operator: (operator) @operator)

; ── Patterns ───────────────────────────────────────────────────────
(constructor_pattern (constructor) @constructor)
(constructor_pattern (qualified_constructor module: (constructor) @module))
(field_pattern label: (identifier) @property)
(wildcard) @variable.parameter

; ── Label literals ────────────────────────────────────────────────
(label_literal) @label

; ── Constructors ───────────────────────────────────────────────────
(constructor) @constructor

; ── Literals ───────────────────────────────────────────────────────
(integer) @number
(double) @number.float
(string) @string
(rune) @character
(escape_sequence) @string.escape

; ── Comments ───────────────────────────────────────────────────────
(line_comment) @comment
(block_comment) @comment

; ── Punctuation ────────────────────────────────────────────────────
["->" "=>" "::" ":=" ":" "~"] @punctuation.special
["(" ")" "[" "]" "{" "}"] @punctuation.bracket
["," ";" "|" "." "\\" "@"] @punctuation.delimiter

; ── Operators (general fallback) ───────────────────────────────────
(operator) @operator
