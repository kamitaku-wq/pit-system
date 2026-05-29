"use client";

// Cloudflare Turnstile widget (explicit rendering)。
// Phase 64-A.33: 公開予約フロー step6/7 の「確認コード送信」前に人間検証を行う。
//
// explicit rendering を使い、callback で取得したトークンを onVerify で親へ渡す (React state 連携)。
// トークンは single-use のため、親は送信ごとに `key` を変えて本コンポーネントを remount し再 challenge
// させること (本コンポーネント自身は mount 時に 1 度だけ render する)。
//
// 実 Cloudflare script は jsdom で動かないため、unit テストでは本モジュールを mock する。

import { useEffect, useRef } from "react";

interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}

declare global {
  // eslint-disable-next-line no-var
  var turnstile: TurnstileApi | undefined;
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
}

export function TurnstileWidget({ onVerify, onExpire, onError }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  // 最新の callback を ref に保持し、effect を mount 時 1 回だけ走らせる (props 変化での再 render churn 回避)。
  const callbacksRef = useRef({ onVerify, onExpire, onError });
  callbacksRef.current = { onVerify, onExpire, onError };

  useEffect(() => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey) return;
    let cancelled = false;
    let interval = 0;

    function renderWidget(): void {
      if (cancelled || widgetIdRef.current !== null) return;
      const el = containerRef.current;
      const api = globalThis.turnstile;
      if (!el || !api) return;
      widgetIdRef.current = api.render(el, {
        sitekey: siteKey as string,
        callback: (token) => callbacksRef.current.onVerify(token),
        "expired-callback": () => callbacksRef.current.onExpire?.(),
        "error-callback": () => callbacksRef.current.onError?.(),
      });
      if (interval !== 0) {
        window.clearInterval(interval);
        interval = 0;
      }
    }

    if (!globalThis.turnstile && !document.getElementById(SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    // script load タイミングに依存せず、turnstile が生えたら render する (load 済みでも発火させる)。
    renderWidget();
    interval = window.setInterval(renderWidget, 200);

    return () => {
      cancelled = true;
      if (interval !== 0) window.clearInterval(interval);
      const api = globalThis.turnstile;
      if (api && widgetIdRef.current !== null) {
        try {
          api.remove(widgetIdRef.current);
        } catch {
          // 既に除去済み等は無視。
        }
      }
      widgetIdRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="cf-turnstile-container" />;
}
