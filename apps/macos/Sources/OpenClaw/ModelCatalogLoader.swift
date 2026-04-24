import Foundation

enum ModelCatalogLoader {
    static var defaultPath: String {
        self.resolveDefaultPath()
    }

    private static let logger = Logger(subsystem: "ai.openclaw", category: "models")
    private nonisolated static let appSupportDir: URL = {
        let base = FileManager().urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("OpenClaw", isDirectory: true)
    }()

    private static var cachePath: URL {
        self.appSupportDir.appendingPathComponent("model-catalog/models.generated.js", isDirectory: false)
    }

    static func load(from path: String) async throws -> [ModelChoice] {
        let expanded = (path as NSString).expandingTildeInPath
        guard let resolved = self.resolvePath(preferred: expanded) else {
            self.logger.error("model catalog load failed: file not found")
            throw NSError(
                domain: "ModelCatalogLoader",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Model catalog file not found"])
        }
        self.logger.debug("model catalog load start file=\(URL(fileURLWithPath: resolved.path).lastPathComponent)")
        let source = try String(contentsOfFile: resolved.path, encoding: .utf8)
        guard let rawModels = try self.parseModels(source: source) else {
            self.logger.error("model catalog parse failed: MODELS missing")
            throw NSError(
                domain: "ModelCatalogLoader",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to parse models.generated.ts"])
        }

        var choices: [ModelChoice] = []
        for (provider, value) in rawModels {
            guard let models = value as? [String: Any] else { continue }
            for (id, payload) in models {
                guard let dict = payload as? [String: Any] else { continue }
                let name = dict["name"] as? String ?? id
                let ctxWindow = dict["contextWindow"] as? Int
                choices.append(ModelChoice(id: id, name: name, provider: provider, contextWindow: ctxWindow))
            }
        }

        let sorted = choices.sorted { lhs, rhs in
            if lhs.provider == rhs.provider {
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
            return lhs.provider.localizedCaseInsensitiveCompare(rhs.provider) == .orderedAscending
        }
        self.logger.debug("model catalog loaded providers=\(rawModels.count) models=\(sorted.count)")
        if resolved.shouldCache {
            self.cacheCatalog(sourcePath: resolved.path)
        }
        return sorted
    }

    private static func resolveDefaultPath() -> String {
        let cache = self.cachePath.path
        if FileManager().isReadableFile(atPath: cache) { return cache }
        if let bundlePath = self.bundleCatalogPath() { return bundlePath }
        if let nodePath = self.nodeModulesCatalogPath() { return nodePath }
        return cache
    }

    private static func resolvePath(preferred: String) -> (path: String, shouldCache: Bool)? {
        if FileManager().isReadableFile(atPath: preferred) {
            return (preferred, preferred != self.cachePath.path)
        }

        if let bundlePath = self.bundleCatalogPath(), bundlePath != preferred {
            self.logger.warning("model catalog path missing; falling back to bundled catalog")
            return (bundlePath, true)
        }

        let cache = self.cachePath.path
        if cache != preferred, FileManager().isReadableFile(atPath: cache) {
            self.logger.warning("model catalog path missing; falling back to cached catalog")
            return (cache, false)
        }

        if let nodePath = self.nodeModulesCatalogPath(), nodePath != preferred {
            self.logger.warning("model catalog path missing; falling back to node_modules catalog")
            return (nodePath, true)
        }

        return nil
    }

    private static func bundleCatalogPath() -> String? {
        guard let url = Bundle.main.url(forResource: "models.generated", withExtension: "js") else {
            return nil
        }
        return url.path
    }

    private static func nodeModulesCatalogPath() -> String? {
        let roots = [
            URL(fileURLWithPath: CommandResolver.projectRootPath()),
            URL(fileURLWithPath: FileManager().currentDirectoryPath),
        ]
        for root in roots {
            let candidate = root
                .appendingPathComponent("node_modules/@mariozechner/pi-ai/dist/models.generated.js")
            if FileManager().isReadableFile(atPath: candidate.path) {
                return candidate.path
            }
        }
        return nil
    }

    private static func cacheCatalog(sourcePath: String) {
        let destination = self.cachePath
        do {
            try FileManager().createDirectory(
                at: destination.deletingLastPathComponent(),
                withIntermediateDirectories: true)
            if FileManager().fileExists(atPath: destination.path) {
                try FileManager().removeItem(at: destination)
            }
            try FileManager().copyItem(atPath: sourcePath, toPath: destination.path)
            self.logger.debug("model catalog cached file=\(destination.lastPathComponent)")
        } catch {
            self.logger.warning("model catalog cache failed: \(error.localizedDescription)")
        }
    }

    private static func parseModels(source: String) throws -> [String: Any]? {
        guard let literal = self.extractModelsLiteral(source: source) else {
            return [:]
        }
        let json = self.jsonFromObjectLiteral(literal)
        guard let data = json.data(using: .utf8) else {
            return nil
        }
        return try JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private static func extractModelsLiteral(source: String) -> String? {
        guard let exportRange = source.range(of: "export const MODELS"),
              let firstBrace = source[exportRange.upperBound...].firstIndex(of: "{"),
              let lastBrace = self.matchingClosingBrace(in: source, from: firstBrace)
        else {
            return nil
        }
        return String(source[firstBrace...lastBrace])
    }

    private static func matchingClosingBrace(in source: String, from firstBrace: String.Index) -> String.Index? {
        let chars = Array(source[firstBrace...])
        var depth = 0
        var index = 0
        while index < chars.count {
            let char = chars[index]
            if char == "\"" || char == "'" {
                index = self.indexAfterStringLiteral(chars, from: index)
                continue
            }
            if char == "/", self.isLineComment(chars, at: index) {
                index = self.indexAfterLineComment(chars, from: index)
                continue
            }
            if char == "/", self.isBlockComment(chars, at: index) {
                index = self.indexAfterBlockComment(chars, from: index)
                continue
            }
            if char == "{" {
                depth += 1
            } else if char == "}" {
                depth -= 1
                if depth == 0 {
                    return source.index(firstBrace, offsetBy: index)
                }
            }
            index += 1
        }
        return nil
    }

    private static func jsonFromObjectLiteral(_ literal: String) -> String {
        let chars = Array(literal)
        var json = ""
        var index = 0
        while index < chars.count {
            let char = chars[index]
            if char == "\"" || char == "'" {
                let (encoded, nextIndex) = self.readJSONString(chars, from: index)
                json += encoded
                index = nextIndex
                continue
            }
            if char == "/", self.isLineComment(chars, at: index) {
                index = self.indexAfterLineComment(chars, from: index)
                continue
            }
            if char == "/", self.isBlockComment(chars, at: index) {
                index = self.indexAfterBlockComment(chars, from: index)
                continue
            }
            if char == "," {
                if let next = self.nextSignificantIndex(chars, from: index + 1),
                   chars[next] == "}" || chars[next] == "]" {
                    index += 1
                    continue
                }
                json.append(char)
                index += 1
                continue
            }
            if self.isIdentifierStart(char) {
                let start = index
                index += 1
                while index < chars.count, self.isIdentifierPart(chars[index]) {
                    index += 1
                }
                let identifier = String(chars[start..<index])
                if let next = self.nextSignificantIndex(chars, from: index), chars[next] == ":" {
                    json += "\"\(identifier)\""
                    continue
                }
                if identifier == "as" || identifier == "satisfies" {
                    index = self.indexAfterTypeAnnotation(chars, from: index)
                    continue
                }
                json += identifier
                continue
            }
            json.append(char)
            index += 1
        }
        return json
    }

    private static func readJSONString(_ chars: [Character], from start: Int) -> (String, Int) {
        let quote = chars[start]
        var result = quote == "'" ? "\"" : String(quote)
        var index = start + 1
        while index < chars.count {
            let char = chars[index]
            if char == "\\" {
                if index + 1 < chars.count {
                    result.append(char)
                    result.append(chars[index + 1])
                    index += 2
                    continue
                }
                result.append(char)
                index += 1
                continue
            }
            if char == quote {
                result += "\""
                return (result, index + 1)
            }
            if quote == "'", char == "\"" {
                result += "\\\""
            } else {
                result.append(char)
            }
            index += 1
        }
        return (result, index)
    }

    private static func indexAfterStringLiteral(_ chars: [Character], from start: Int) -> Int {
        let quote = chars[start]
        var index = start + 1
        while index < chars.count {
            if chars[index] == "\\" {
                index += 2
                continue
            }
            if chars[index] == quote {
                return index + 1
            }
            index += 1
        }
        return index
    }

    private static func indexAfterTypeAnnotation(_ chars: [Character], from start: Int) -> Int {
        var index = start
        while index < chars.count {
            let char = chars[index]
            if char == "," || char == "}" || char == "]" {
                return index
            }
            index += 1
        }
        return index
    }

    private static func nextSignificantIndex(_ chars: [Character], from start: Int) -> Int? {
        var index = start
        while index < chars.count {
            if chars[index].isWhitespace {
                index += 1
                continue
            }
            if chars[index] == "/", self.isLineComment(chars, at: index) {
                index = self.indexAfterLineComment(chars, from: index)
                continue
            }
            if chars[index] == "/", self.isBlockComment(chars, at: index) {
                index = self.indexAfterBlockComment(chars, from: index)
                continue
            }
            return index
        }
        return nil
    }

    private static func isLineComment(_ chars: [Character], at index: Int) -> Bool {
        index + 1 < chars.count && chars[index + 1] == "/"
    }

    private static func isBlockComment(_ chars: [Character], at index: Int) -> Bool {
        index + 1 < chars.count && chars[index + 1] == "*"
    }

    private static func indexAfterLineComment(_ chars: [Character], from start: Int) -> Int {
        var index = start + 2
        while index < chars.count, chars[index] != "\n" {
            index += 1
        }
        return index
    }

    private static func indexAfterBlockComment(_ chars: [Character], from start: Int) -> Int {
        var index = start + 2
        while index + 1 < chars.count {
            if chars[index] == "*", chars[index + 1] == "/" {
                return index + 2
            }
            index += 1
        }
        return chars.count
    }

    private static func isIdentifierStart(_ char: Character) -> Bool {
        char == "_" || char == "$" || char.isLetter
    }

    private static func isIdentifierPart(_ char: Character) -> Bool {
        self.isIdentifierStart(char) || char.isNumber
    }
}
