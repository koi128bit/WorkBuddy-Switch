import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWrite, readOptional } from "./files.mjs";
import {
  editorDefinition,
  editorDataPath,
} from "./editor-controller.mjs";
import {
  authFingerprint,
  hasEditorLogin,
  readEditorAuth,
  readStableEditorAuth,
  validateEditorAuth,
  writeEditorAuth,
} from "./editor-auth.mjs";

export class EditorStore {
  records = [];
  loadError = null;
  constructor({
    directory,
    vault,
    settings,
    controllers,
    context = {},
    onChange = () => {},
  }) {
    Object.assign(this, {
      directory,
      vault,
      settings,
      controllers,
      context,
      onChange,
    });
  }
  get file() {
    return path.join(this.directory, "editor-vault.json");
  }
  dataPath(provider) {
    return editorDataPath(provider, this.settings(), this.context);
  }
  recoveryPath(provider) {
    editorDefinition(provider);
    return path.join(this.directory, `editor-recovery-${provider}.json`);
  }
  async init() {
    const raw = await readOptional(this.file);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (
        data.version !== 1 ||
        !Array.isArray(data.records) ||
        data.records.length > 1000
      )
        throw new Error("invalid");
      const ids = new Set();
      for (const record of data.records) {
        editorDefinition(record.provider);
        if (
          !record.profile ||
          typeof record.profile.id !== "string" ||
          typeof record.profile.nickname !== "string" ||
          typeof record.encrypted !== "string" ||
          !/^[a-f0-9]{64}$/.test(record.fingerprint) ||
          ids.has(record.profile.id)
        )
          throw new Error("invalid");
        ids.add(record.profile.id);
      }
      this.records = data.records;
    } catch {
      this.loadError =
        "国内版客户端快照库损坏，请保留 editor-vault.json 后恢复备份；WorkBuddy 账号库不受影响。";
    }
  }
  protect(document) {
    if (!this.vault.available())
      throw new Error("系统加密服务不可用，无法保存登录快照。");
    return this.vault.encrypt(JSON.stringify(document)).toString("base64");
  }
  unprotect(encrypted, provider) {
    try {
      return validateEditorAuth(
        JSON.parse(this.vault.decrypt(Buffer.from(encrypted, "base64"))),
        provider,
      );
    } catch {
      throw new Error(
        "无法解密或验证登录快照，请解锁系统钥匙串或重新保存账号。",
      );
    }
  }
  async save(records) {
    if (this.loadError) throw new Error(this.loadError);
    await atomicWrite(
      this.file,
      JSON.stringify({ version: 1, records }, null, 2),
    );
    this.records = records;
    this.onChange();
  }
  async capture(provider, nickname, automatic = false, supplied = null) {
    editorDefinition(provider);
    if (this.loadError) throw new Error(this.loadError);
    if (
      typeof nickname !== "string" ||
      !nickname.trim() ||
      nickname.length > 80
    )
      throw new Error("请输入 1–80 个字符的快照名称。");
    const document =
      supplied ||
      (await readStableEditorAuth(
        provider,
        this.dataPath(provider),
        this.context,
      ));
    if (!hasEditorLogin(document))
      throw new Error(
        `请先在 ${editorDefinition(provider).name} 登录，再保存当前账号。`,
      );
    const fingerprint = authFingerprint(document);
    const prior = this.records.find(
      (record) =>
        record.provider === provider && record.fingerprint === fingerprint,
    );
    const record = {
      provider,
      fingerprint,
      encrypted: this.protect(document),
      profile: {
        id: prior?.profile.id || randomUUID(),
        nickname: prior?.profile.nickname || nickname.trim(),
        note: prior?.profile.note || "",
        favorite: prior?.profile.favorite || false,
        capturedAt: prior?.profile.capturedAt || Date.now(),
        lastUsedAt: Date.now(),
        automatic: prior?.profile.automatic ?? automatic,
      },
    };
    if (this.records.length >= 1000 && !prior)
      throw new Error("快照数量已达上限，请先移除不再需要的快照。");
    await this.save([
      ...this.records.filter((item) => item.profile.id !== record.profile.id),
      record,
    ]);
    return record.profile;
  }
  record(provider, id) {
    editorDefinition(provider);
    const record = this.records.find(
      (item) => item.provider === provider && item.profile.id === id,
    );
    if (!record) throw new Error("未找到该客户端的登录快照，请刷新后重试。");
    return record;
  }
  async edit(provider, id, patch) {
    const record = this.record(provider, id);
    if (
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch) ||
      Object.keys(patch).some(
        (key) => !["nickname", "note", "favorite"].includes(key),
      )
    )
      throw new Error("快照信息格式无效。");
    if (
      "nickname" in patch &&
      (typeof patch.nickname !== "string" ||
        !patch.nickname.trim() ||
        patch.nickname.length > 80)
    )
      throw new Error("快照名称应为 1–80 个字符。");
    if (
      "note" in patch &&
      (typeof patch.note !== "string" || patch.note.length > 300)
    )
      throw new Error("备注最多 300 个字符。");
    if ("favorite" in patch && typeof patch.favorite !== "boolean")
      throw new Error("收藏设置无效。");
    await this.save(
      this.records.map((item) =>
        item === record
          ? {
              ...item,
              profile: {
                ...item.profile,
                ...patch,
                ...("nickname" in patch
                  ? { nickname: patch.nickname.trim() }
                  : {}),
              },
            }
          : item,
      ),
    );
  }
  async remove(provider, id) {
    const record = this.record(provider, id);
    await this.save(this.records.filter((item) => item !== record));
  }
  async switchAccount(provider, id) {
    if (this.loadError) throw new Error(this.loadError);
    if (!this.vault.available())
      throw new Error("系统加密服务不可用，已停止切换。");
    const record = this.record(provider, id);
    const target = this.unprotect(record.encrypted, provider);
    if (
      !hasEditorLogin(target) ||
      authFingerprint(target) !== record.fingerprint
    )
      throw new Error("快照完整性检查失败，已停止切换。");
    const controller = this.controllers[provider],
      directory = this.dataPath(provider);
    const context = this.context;
    const before = await readEditorAuth(provider, directory, context);
    if (await readOptional(this.recoveryPath(provider)))
      throw new Error("上次切换有待恢复记录，请先恢复切换前登录。");
    if (authFingerprint(before) === record.fingerprint) {
      await controller.launch();
      return;
    }
    const wasRunning = (await controller.status()).running;
    let journal = null;
    try {
      await controller.stop();
      await controller.assertStopped();
      const latest = await readEditorAuth(provider, directory, context);
      if (
        provider === "qoder-cn" &&
        latest.entries["auth-profile-overlays.v1.dat"] &&
        !target.entries["auth-profile-overlays.v1.dat"]
      )
        throw new Error(
          "Qoder CN 已新增登录配置，请在当前版本重新保存目标账号，避免恢复不完整的旧快照。",
        );
      if (hasEditorLogin(latest))
        await this.capture(
          provider,
          `切换前登录 ${new Date().toLocaleString("zh-CN")}`,
          true,
          latest,
        );
      journal = {
        version: 1,
        provider,
        directory,
        before: latest,
        target,
        at: Date.now(),
      };
      await atomicWrite(
        this.recoveryPath(provider),
        JSON.stringify({
          version: 1,
          encrypted: this.vault
            .encrypt(JSON.stringify(journal))
            .toString("base64"),
        }),
      );
      await controller.assertStopped();
      if (
        authFingerprint(await readEditorAuth(provider, directory, context)) !==
        authFingerprint(latest)
      )
        throw new Error("客户端登录信息在退出后发生变化，已停止切换。");
      await writeEditorAuth(provider, directory, target, context);
      if (
        authFingerprint(await readEditorAuth(provider, directory, context)) !==
        record.fingerprint
      )
        throw new Error("登录快照写入后检查失败。");
      await this.save(
        this.records.map((item) =>
          item.profile.id === id
            ? { ...item, profile: { ...item.profile, lastUsedAt: Date.now() } }
            : item,
        ),
      );
      if (this.settings().restartAfterSwitch) await controller.launch();
      await fs.rm(this.recoveryPath(provider), { force: true });
      this.onChange();
    } catch (error) {
      if (journal) {
        try {
          await controller.stop();
          await controller.assertStopped();
          const current = await readEditorAuth(provider, directory, context);
          if (!this.restorable(current, journal))
            throw new Error("new login detected");
          await writeEditorAuth(provider, directory, journal.before, context);
          if (
            authFingerprint(
              await readEditorAuth(provider, directory, context),
            ) !== authFingerprint(journal.before)
          )
            throw new Error("restore mismatch");
          await fs.rm(this.recoveryPath(provider), { force: true });
        } catch {
          throw new Error(
            "切换失败，自动恢复未完成。加密恢复记录已保留，请关闭客户端后点击「恢复切换前登录」。",
          );
        }
      }
      if (wasRunning)
        try {
          await controller.launch();
        } catch {
          throw new Error(
            "切换未完成，原登录已保留；客户端重新启动失败，请手动打开。",
          );
        }
      throw error;
    }
  }
  async restore(provider) {
    const raw = await readOptional(this.recoveryPath(provider));
    if (!raw) throw new Error("没有待恢复的登录记录。");
    let journal;
    try {
      journal = JSON.parse(
        this.vault.decrypt(Buffer.from(JSON.parse(raw).encrypted, "base64")),
      );
    } catch {
      throw new Error("恢复记录无法解密，请保留文件并重新保存登录账号。");
    }
    if (
      journal.version !== 1 ||
      journal.provider !== provider ||
      journal.directory !== this.dataPath(provider)
    )
      throw new Error("恢复记录的客户端路径不一致，请先恢复原路径配置。");
    const controller = this.controllers[provider];
    await controller.stop();
    await controller.assertStopped();
    const current = await readEditorAuth(
      provider,
      journal.directory,
      this.context,
    );
    if (!this.restorable(current, journal))
      throw new Error(
        "登录信息已在切换后发生变化，为保护新登录已停止恢复。请手动保存当前账号。",
      );
    await writeEditorAuth(
      provider,
      journal.directory,
      validateEditorAuth(journal.before, provider),
      this.context,
    );
    if (
      authFingerprint(
        await readEditorAuth(provider, journal.directory, this.context),
      ) !== authFingerprint(journal.before)
    )
      throw new Error("恢复检查失败，加密恢复记录仍保留。");
    await fs.rm(this.recoveryPath(provider), { force: true });
    if (this.settings().restartAfterSwitch) await controller.launch();
    this.onChange();
  }
  restorable(current, journal) {
    validateEditorAuth(journal.before, current.provider);
    validateEditorAuth(journal.target, current.provider);
    return Object.entries(current.entries).every(
      ([key, value]) =>
        JSON.stringify(value) === JSON.stringify(journal.before.entries[key]) ||
        JSON.stringify(value) === JSON.stringify(journal.target.entries[key]),
    );
  }
  async keepCurrent(provider) {
    const source = this.recoveryPath(provider);
    if (!(await readOptional(source)))
      throw new Error("没有待归档的恢复记录。");
    const directory = this.dataPath(provider);
    const current = await readStableEditorAuth(
      provider,
      directory,
      this.context,
    );
    if (hasEditorLogin(current))
      await this.capture(
        provider,
        `保留当前登录 ${new Date().toLocaleString("zh-CN")}`,
        true,
        current,
      );
    if (
      authFingerprint(current) !==
      authFingerprint(await readEditorAuth(provider, directory, this.context))
    )
      throw new Error("当前登录已变化，请稍后重试，恢复记录已保留。");
    await fs.rename(
      source,
      path.join(
        this.directory,
        `editor-recovery-archive-${provider}-${Date.now()}-${randomUUID()}.json`,
      ),
    );
    this.onChange();
  }
  async snapshots() {
    return Object.fromEntries(
      await Promise.all(
        Object.keys(this.controllers).map(async (provider) => {
          const definition = editorDefinition(provider);
          let current = null,
            error = this.loadError,
            client = { installed: false, running: null, executable: null },
            hasLogin = false;
          try {
            const document = await readEditorAuth(
              provider,
              this.dataPath(provider),
              this.context,
            );
            hasLogin = hasEditorLogin(document);
            current =
              this.records.find(
                (record) =>
                  record.provider === provider &&
                  record.fingerprint === authFingerprint(document),
              )?.profile.id || null;
          } catch (e) {
            error = e.message;
          }
          try {
            client = await this.controllers[provider].status();
          } catch (e) {
            error ||= e.message;
          }
          return [
            provider,
            {
              provider,
              name: definition.name,
              accounts: this.records
                .filter((record) => record.provider === provider)
                .map((record) => record.profile),
              currentId: current,
              hasLogin,
              error,
              client,
              dataPath: this.dataPath(provider),
              recoveryPending: !!(await readOptional(
                this.recoveryPath(provider),
              )),
            },
          ];
        }),
      ),
    );
  }
}
