'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastType = 'success' | 'error' | 'info';

export type ToastOptions = {
  message: string;
  type?: ToastType;
  duration?: number;
};

type ToastItem = ToastOptions & {
  id: number;
};

type ToastContextValue = {
  show: (options: ToastOptions) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 2000;

let toastBridge: ToastContextValue | null = null;

function bindBridge(value: ToastContextValue | null) {
  toastBridge = value;
}

/** 在 Provider 外也可调用（如事件委托） */
export function showToast(options: ToastOptions) {
  if (!toastBridge) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Toast] ToastProvider 未挂载，无法显示提示');
    }
    return;
  }
  toastBridge.show(options);
}

export async function copyToClipboard(
  text: string,
  successMessage = '已复制到剪贴板'
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    showToast({ message: successMessage, type: 'success' });
    return true;
  } catch {
    showToast({ message: '复制失败', type: 'error' });
    return false;
  }
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast 必须在 ToastProvider 内使用');
  }
  return ctx;
}

function ToastView({ item, onDone }: { item: ToastItem; onDone: (id: number) => void }) {
  const [visible, setVisible] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const enterId = requestAnimationFrame(() => setVisible(true));
    const duration = item.duration ?? DEFAULT_DURATION;
    const timer = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(() => {
        if (!doneRef.current) {
          doneRef.current = true;
          onDone(item.id);
        }
      }, 220);
    }, duration);
    return () => {
      cancelAnimationFrame(enterId);
      window.clearTimeout(timer);
    };
  }, [item.duration, item.id, onDone]);

  return (
    <div
      className={`appToast appToast--${item.type ?? 'success'} ${visible ? 'appToast--visible' : ''}`}
      role="status"
      aria-live="polite"
    >
      {item.message}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const regionId = useId();

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { ...options, id }]);
  }, []);

  const success = useCallback(
    (message: string, duration?: number) => show({ message, type: 'success', duration }),
    [show]
  );

  const error = useCallback(
    (message: string, duration?: number) => show({ message, type: 'error', duration }),
    [show]
  );

  const info = useCallback(
    (message: string, duration?: number) => show({ message, type: 'info', duration }),
    [show]
  );

  const api = useRef<ToastContextValue>({ show, success, error, info });
  api.current = { show, success, error, info };

  useEffect(() => {
    bindBridge(api.current);
    return () => bindBridge(null);
  }, [show, success, error, info]);

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <div
        id={regionId}
        className="appToastRegion"
        aria-label="操作提示"
      >
        {toasts.map((item) => (
          <ToastView key={item.id} item={item} onDone={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
