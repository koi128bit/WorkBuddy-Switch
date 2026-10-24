import { useState, useEffect, useRef } from "react";
import { ExternalLink, Globe, ShieldCheck } from "lucide-react";
import { Button, Modal } from "./components";
import { apiFor, providerNames, isWorkBuddy } from "./providers";
import type { Provider } from "./types";
export function LoginModal({
  ticket,
  provider,
  close,
  complete,
}: {
  ticket: { id: string; expiresAt: number };
  provider: Provider;
  close: () => void;
  complete: () => void;
}) {
  const api = apiFor(provider);
  const [message, setMessage] = useState("请在官方网页完成登录或扫码授权。"),
    [failure, setFailure] = useState("");
  const completeRef = useRef(complete);
  completeRef.current = complete;
  useEffect(() => {
    let stopped = false,
      running = false;
    const timer = setInterval(async () => {
      if (stopped || running) return;
      if (Date.now() >= ticket.expiresAt) {
        setFailure("授权请求已过期，请关闭弹窗后重新开始。");
        clearInterval(timer);
        return;
      }
      running = true;
      try {
        const result = await api.pollLogin(ticket.id);
        if (!stopped && result.done) {
          clearInterval(timer);
          completeRef.current();
        }
      } catch (e) {
        if (!stopped) {
          setFailure((e as Error).message);
          clearInterval(timer);
        }
      } finally {
        running = false;
      }
    }, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [ticket, api]);
  return (
    <Modal
      title="网页登录添加账号"
      subtitle={`在 ${providerNames[provider]} 官方页面授权，登录信息加密保存在本机。`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>取消登录</Button>
          <Button
            primary
            icon={ExternalLink}
            disabled={!!failure}
            onClick={() => {
              void api
                .openLogin(ticket.id)
                .then(() =>
                  setMessage("官方授权页面已打开，完成后会自动保存账号。"),
                )
                .catch((e: Error) => setFailure(e.message));
            }}
          >
            打开官方登录页
          </Button>
        </>
      }
    >
      <div className="confirm-icon">
        <Globe size={26} />
      </div>
      <p className="confirmation-copy">{failure || message}</p>
      {!isWorkBuddy(provider) && (
        <p className="quiet-note">
          首次切换前，请在客户端登录这个账号并保存当前账号，关联完整登录资料。
        </p>
      )}
      <div className="inline-note">
        <ShieldCheck size={15} />
        授权有效期 5 分钟。添加账号后，当前客户端继续使用原来的身份。
      </div>
    </Modal>
  );
}
