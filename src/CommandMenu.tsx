import { useEffect, useId, useRef, useState } from "react";
import { CornerDownLeft, Search, X, type LucideIcon } from "lucide-react";
import { Modal } from "./components";

export interface WorkspaceCommand {
  id: string;
  label: string;
  keywords: string;
  detail: string;
  icon: LucideIcon;
  run: () => void;
}
export function CommandMenu({
  commands,
  onClose,
}: {
  commands: WorkspaceCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const filtered = commands.filter((command) =>
    `${command.label} ${command.keywords} ${command.detail}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  useEffect(() => {
    input.current?.focus();
  }, []);
  const execute = (command: WorkspaceCommand) => {
    onClose();
    command.run();
  };
  return (
    <Modal
      title="命令搜索"
      onClose={onClose}
      footer={
        <div className="command-hints">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>选择
          </span>
          <span>
            <kbd>↵</kbd>打开
          </span>
          <span>
            <kbd>esc</kbd>关闭
          </span>
        </div>
      }
    >
      <div className="command-search">
        <Search size={20} />
        <input
          ref={input}
          role="combobox"
          aria-label="搜索命令"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            filtered[index] ? `${listId}-${index}` : undefined
          }
          placeholder="搜索页面和操作…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((current) =>
                filtered.length
                  ? (current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      filtered.length) %
                    filtered.length
                  : 0,
              );
            }
            if (event.key === "Enter" && filtered[index]) {
              event.preventDefault();
              execute(filtered[index]);
            }
          }}
        />
        <button
          className="icon-button"
          aria-label="清空搜索"
          onClick={() => {
            setQuery("");
            setIndex(0);
            input.current?.focus();
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div
        className="command-list"
        id={listId}
        role="listbox"
        aria-label="可用命令"
      >
        {filtered.map((command, i) => (
          <div
            key={command.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={index === i}
            className={`command-option ${index === i ? "selected" : ""}`}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => execute(command)}
          >
            <command.icon size={18} />
            <div>
              <strong>{command.label}</strong>
              <small>{command.detail}</small>
            </div>
            <CornerDownLeft size={14} />
          </div>
        ))}
        {!filtered.length && <p className="command-empty">没有匹配的命令</p>}
      </div>
    </Modal>
  );
}
