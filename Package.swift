// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "TreeSitterGicel",
    products: [
        .library(name: "TreeSitterGicel", targets: ["TreeSitterGicel"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ChimeHQ/SwiftTreeSitter", from: "0.8.0"),
    ],
    targets: [
        .target(
            name: "TreeSitterGicel",
            dependencies: [],
            path: ".",
            sources: [
                "src/parser.c",
                // NOTE: if your language has an external scanner, add it here.
            ],
            resources: [
                .copy("queries")
            ],
            publicHeadersPath: "bindings/swift",
            cSettings: [.headerSearchPath("src")]
        ),
        .testTarget(
            name: "TreeSitterGicelTests",
            dependencies: [
                "SwiftTreeSitter",
                "TreeSitterGicel",
            ],
            path: "bindings/swift/TreeSitterGicelTests"
        )
    ],
    cLanguageStandard: .c11
)
