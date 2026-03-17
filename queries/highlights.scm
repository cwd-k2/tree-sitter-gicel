; GICEL highlight queries for tree-sitter

; ── Keywords ────────────────────────────────────────────────────────
[
  "case"
  "data"
  "do"
  "type"
  "forall"
  "class"
  "instance"
  "import"
  "infixl"
  "infixr"
  "infixn"
] @keyword

; ── Built-in identifiers ───────────────────────────────────────────
((identifier) @function.builtin
  (#any-of? @function.builtin
    "pure" "bind" "thunk" "force" "assumption" "rec" "fix"))

; ── Declarations ───────────────────────────────────────────────────
(data_declaration name: (constructor) @type.definition)
(type_alias_declaration name: (constructor) @type.definition)
(type_family_declaration name: (constructor) @type.definition)
(class_declaration name: (constructor) @type.definition)
(instance_declaration class: (constructor) @type)

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

; ── Type families ─────────────────────────────────────────────────
(type_family_equation name: (constructor) @type)
(assoc_type_signature name: (constructor) @type.definition)
(assoc_data_signature name: (constructor) @type.definition)
(assoc_type_definition name: (constructor) @type)
(assoc_data_definition name: (constructor) @type.definition)

; ── Imports ─────────────────────────────────────────────────────────
(import_declaration (module_name (constructor) @module))

; ── Types ──────────────────────────────────────────────────────────
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

(field_value label: (identifier) @property)
(projection_expression ".#" @operator)
(projection_expression field: (identifier) @property)
(type_application_expression "@" @operator)
(multiplicity_annotation "@" @operator)

; ── Operator sections ─────────────────────────────────────────────
(operator_section operator: (operator) @operator)
(right_section operator: (operator) @operator)
(left_section operator: (operator) @operator)

; ── Patterns ───────────────────────────────────────────────────────
(constructor_pattern (constructor) @constructor)
(field_pattern label: (identifier) @property)
(wildcard) @variable.parameter

; ── Constructors ───────────────────────────────────────────────────
(constructor) @constructor

; ── Literals ───────────────────────────────────────────────────────
(integer) @number
(string) @string
(rune) @character
(escape_sequence) @string.escape

; ── Comments ───────────────────────────────────────────────────────
(line_comment) @comment
(block_comment) @comment

; ── Punctuation ────────────────────────────────────────────────────
["->" "=>" "::" ":="] @punctuation.special
["(" ")" "[" "]" "{" "}"] @punctuation.bracket
["," ";" "|" "." ":" "=" "\\"] @punctuation.delimiter

; ── Operators (general fallback) ───────────────────────────────────
(operator) @operator
