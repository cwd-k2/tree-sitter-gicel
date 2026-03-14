import XCTest
import SwiftTreeSitter
import TreeSitterGicel

final class TreeSitterGicelTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_gicel())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Gicel grammar")
    }
}
