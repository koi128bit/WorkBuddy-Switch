import Foundation
import SQLite3

final class SQLiteDatabase {
    private var handle: OpaquePointer?

    init(url: URL, readOnly: Bool) throws {
        let flags = readOnly
            ? SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX
            : SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(url.path, &handle, flags, nil) == SQLITE_OK else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            sqlite3_close(handle)
            throw OpenUsageError.commandFailed("SQLite 打开失败：\(message)")
        }
        sqlite3_busy_timeout(handle, 2_500)
    }

    deinit {
        sqlite3_close(handle)
    }

    func query(_ sql: String, bindings: [SQLiteValue] = []) throws -> [[String: SQLiteValue]] {
        guard let handle else { throw OpenUsageError.databaseUnavailable }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else {
            throw databaseError(handle)
        }
        defer { sqlite3_finalize(statement) }
        try bind(bindings, to: statement, database: handle)

        var rows: [[String: SQLiteValue]] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { break }
            guard result == SQLITE_ROW else { throw databaseError(handle) }
            var row: [String: SQLiteValue] = [:]
            for index in 0..<sqlite3_column_count(statement) {
                let name = String(cString: sqlite3_column_name(statement, index))
                row[name] = value(from: statement, index: index)
            }
            rows.append(row)
        }
        return rows
    }

    @discardableResult
    func execute(_ sql: String, bindings: [SQLiteValue] = []) throws -> Int {
        guard let handle else { throw OpenUsageError.databaseUnavailable }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else {
            throw databaseError(handle)
        }
        defer { sqlite3_finalize(statement) }
        try bind(bindings, to: statement, database: handle)
        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw databaseError(handle)
        }
        return Int(sqlite3_changes(handle))
    }

    func transaction<T>(_ operation: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do {
            let value = try operation()
            try execute("COMMIT")
            return value
        } catch {
            _ = try? execute("ROLLBACK")
            throw error
        }
    }

    private func bind(
        _ values: [SQLiteValue],
        to statement: OpaquePointer?,
        database: OpaquePointer
    ) throws {
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            let result: Int32
            switch value {
            case .null:
                result = sqlite3_bind_null(statement, index)
            case .integer(let value):
                result = sqlite3_bind_int64(statement, index, value)
            case .double(let value):
                result = sqlite3_bind_double(statement, index, value)
            case .text(let value):
                result = sqlite3_bind_text(statement, index, value, -1, SQLITE_TRANSIENT)
            }
            guard result == SQLITE_OK else { throw databaseError(database) }
        }
    }

    private func value(from statement: OpaquePointer?, index: Int32) -> SQLiteValue {
        switch sqlite3_column_type(statement, index) {
        case SQLITE_INTEGER:
            return .integer(sqlite3_column_int64(statement, index))
        case SQLITE_FLOAT:
            return .double(sqlite3_column_double(statement, index))
        case SQLITE_TEXT:
            return .text(String(cString: sqlite3_column_text(statement, index)))
        default:
            return .null
        }
    }

    private func databaseError(_ database: OpaquePointer) -> Error {
        OpenUsageError.commandFailed("SQLite 操作失败：\(String(cString: sqlite3_errmsg(database)))")
    }
}

enum SQLiteValue: Equatable {
    case null
    case integer(Int64)
    case double(Double)
    case text(String)

    var string: String? {
        switch self {
        case .text(let value): return value
        case .integer(let value): return String(value)
        case .double(let value): return String(value)
        case .null: return nil
        }
    }

    var int64: Int64? {
        switch self {
        case .integer(let value): return value
        case .double(let value): return Int64(value)
        case .text(let value): return Int64(value)
        case .null: return nil
        }
    }
}

private let SQLITE_TRANSIENT = unsafeBitCast(
    -1,
    to: sqlite3_destructor_type.self
)
