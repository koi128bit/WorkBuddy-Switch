import { DatabaseSync, backup } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function columns(db) {
  const keys = new Set(
    db
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((r) => r.name),
  );
  if (!keys.has("id") || !keys.has("user_id"))
    throw new Error("WorkBuddy 对话数据库结构无法识别。");
  return keys;
}

export function loadSessions(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const c = columns(db);
    const field = (key, fallback = "NULL") => (c.has(key) ? key : fallback);
    const title = c.has("custom_title")
      ? `COALESCE(NULLIF(custom_title, ''), ${field("title")}, '未命名对话')`
      : `COALESCE(${field("title")}, '未命名对话')`;
    const updated = `COALESCE(${field("last_activity_at")}, ${field("updated_at")}, ${field("created_at", "0")})`;
    return db
      .prepare(
        `SELECT id, user_id, ${title} AS display_title, ${field("cwd", "''")} AS cwd, ${field("status", "''")} AS status,
      ${field("model")} AS model, ${field("created_at", "0")} AS created_at, ${updated} AS updated_at, ${field("deleted_at")} AS deleted_at FROM sessions ORDER BY updated_at DESC`,
      )
      .all()
      .map((r) => ({
        id: String(r.id),
        userId: String(r.user_id),
        title: String(r.display_title),
        directory: String(r.cwd),
        status: String(r.status),
        model: r.model ? String(r.model) : null,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        deleted: r.deleted_at !== null,
      }));
  } finally {
    db.close();
  }
}

export async function backupDatabase(file, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    await backup(db, destination);
    const check = new DatabaseSync(destination);
    try {
      check.exec("PRAGMA journal_mode = DELETE");
      if (
        check.prepare("PRAGMA integrity_check").get().integrity_check !== "ok"
      )
        throw new Error("对话备份完整性检查失败。");
    } finally {
      check.close();
    }
    if (process.platform !== "win32") await fs.chmod(destination, 0o600);
  } finally {
    db.close();
  }
}

export async function prepareSession(file, directory, expected, targetId) {
  const initial = loadSessions(file).find((s) => s.id === expected.id);
  if (
    !initial ||
    initial.userId !== expected.userId ||
    initial.deleted !== expected.deleted
  )
    throw new Error("对话状态已变化，请刷新列表后重试。");
  if (initial.userId === targetId && !initial.deleted) return null;
  const destination = path.join(
    directory,
    `workbuddy-${Date.now()}-${randomUUID()}.db`,
  );
  await backupDatabase(file, destination);
  const db = new DatabaseSync(file);
  let committed = false;
  let originalRow;
  try {
    db.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    const c = columns(db);
    originalRow = db
      .prepare(
        `SELECT user_id, ${c.has("deleted_at") ? "deleted_at" : "NULL AS deleted_at"}, ${c.has("updated_at") ? "updated_at" : "NULL AS updated_at"} FROM sessions WHERE id = ?`,
      )
      .get(expected.id);
    const assignments = ["user_id = ?"],
      bindings = [targetId];
    if (c.has("deleted_at")) assignments.push("deleted_at = NULL");
    if (c.has("updated_at")) {
      assignments.push("updated_at = ?");
      bindings.push(Date.now());
    }
    bindings.push(expected.id, expected.userId);
    const deletedClause = c.has("deleted_at")
      ? ` AND deleted_at IS ${expected.deleted ? "NOT " : ""}NULL`
      : "";
    const result = db
      .prepare(
        `UPDATE sessions SET ${assignments.join(", ")} WHERE id = ? AND user_id = ?${deletedClause}`,
      )
      .run(...bindings);
    if (Number(result.changes) !== 1)
      throw new Error("对话状态已变化，已停止迁移。");
    db.exec("COMMIT");
    committed = true;
    const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (checkpoint?.busy !== 0)
      throw new Error("数据库仍被占用，迁移后的检查点未完成。");
    const after = loadSessions(file).find((s) => s.id === expected.id);
    if (!after || after.userId !== targetId || after.deleted)
      throw new Error("迁移结果检查失败。");
    return destination;
  } catch (error) {
    if (!committed) db.exec("ROLLBACK");
    else {
      // Undo only the row we changed; never replace the whole live database.
      const assignments = ["user_id = ?"],
        values = [expected.userId];
      if (columns(db).has("deleted_at")) {
        assignments.push("deleted_at = ?");
        values.push(originalRow.deleted_at);
      }
      if (columns(db).has("updated_at")) {
        assignments.push("updated_at = ?");
        values.push(originalRow.updated_at);
      }
      const undo = db
        .prepare(
          `UPDATE sessions SET ${assignments.join(", ")} WHERE id = ? AND user_id = ?`,
        )
        .run(...values, expected.id, targetId);
      if (Number(undo.changes) !== 1)
        throw new Error(
          `迁移检查与自动撤销失败，请从设置查看安全备份：${path.basename(destination)}`,
        );
    }
    throw error;
  } finally {
    db.close();
  }
}
