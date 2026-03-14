package tree_sitter_gicel_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_gicel "github.com/cwd-k2/tree-sitter-gicel.git/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_gicel.Language())
	if language == nil {
		t.Errorf("Error loading Gicel grammar")
	}
}
