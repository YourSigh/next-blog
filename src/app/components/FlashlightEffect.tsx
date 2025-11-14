'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Test from './test/test';

export default function FlashlightEffect() {
  const [lightsOn, setLightsOn] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [radius, setRadius] = useState(120);
  const [feather, setFeather] = useState(90);
  const [isVisible, setIsVisible] = useState(false);
  const [isArmed, setIsArmed] = useState(false);
  
  const pullRef = useRef<HTMLDivElement>(null);
  const pullAreaRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);

  // 更新 CSS 变量
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const root = document.documentElement;
    const mx = position.x || window.innerWidth / 2;
    const my = position.y || window.innerHeight / 2;
    
    root.style.setProperty('--mx', `${mx}px`);
    root.style.setProperty('--my', `${my}px`);
    root.style.setProperty('--r', `${radius}px`);
    root.style.setProperty('--feather', `${feather}px`);
  }, [position, radius, feather]);

  // 检查拉绳是否在手电筒范围内
  useEffect(() => {
    if (lightsOn || !pullAreaRef.current || !pullRef.current) return;
    
    const updateVisibility = () => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      
      requestAnimationFrame(() => {
        const rect = pullAreaRef.current?.getBoundingClientRect();
        if (!rect) {
          pendingRef.current = false;
          return;
        }
        
        const cx = rect.right - 30;
        const cy = rect.top + 100;
        const dx = position.x - cx;
        const dy = position.y - cy;
        const dist = Math.hypot(dx, dy);
        const visibleRadius = radius + feather * 0.55;
        
        if (dist <= visibleRadius) {
          setIsVisible(true);
          setIsArmed(false);
        } else {
          setIsVisible(false);
          setIsArmed(true);
        }
        pendingRef.current = false;
      });
    };
    
    updateVisibility();
  }, [position, radius, feather, lightsOn]);

  // 初始化位置和 body 样式
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      
      // 添加 body 类名来应用样式
      document.body.classList.add('flashlight-page');
      
      return () => {
        // 清理类名
        document.body.classList.remove('flashlight-page', 'lights-on', 'pulling');
      };
    }
  }, []);

  // 更新 body 类名
  useEffect(() => {
    if (lightsOn) {
      document.body.classList.add('lights-on');
    } else {
      document.body.classList.remove('lights-on');
    }
  }, [lightsOn]);

  useEffect(() => {
    if (pulling) {
      document.body.classList.add('pulling');
    } else {
      document.body.classList.remove('pulling');
    }
  }, [pulling]);

  // 鼠标移动
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX, y: e.clientY });
    };
    
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        setPosition({ x: touch.clientX, y: touch.clientY });
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  const toggleLights = useCallback(() => {
    setPulling(true);
    setTimeout(() => setPulling(false), 450);
    
    setLightsOn((prev) => {
      const newLightsOn = !prev;
      
      if (newLightsOn) {
        setIsVisible(true);
        setIsArmed(false);
      } else {
        setIsVisible(false);
        setIsArmed(true);
      }
      
      return newLightsOn;
    });
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || e.key === 'Meta') {
        setRadius(220);
        setFeather(140);
      } else if (e.key === 'Shift') {
        setRadius(90);
        setFeather(70);
      } else if (e.key.toLowerCase() === 'l') {
        toggleLights();
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || e.key === 'Meta' || e.key === 'Shift') {
        setRadius(120);
        setFeather(90);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [toggleLights]);

  const handlePullKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleLights();
    }
  };

  return (
    <>
      <style jsx global>{`
        .flashlight-page {
          margin: 0 !important;
          background: #000 !important;
          color: #fff !important;
          min-height: 100vh !important;
          cursor: url('/light_cursor.png'), auto;
        }

        .flashlight-page * {
          cursor: url('/light_cursor.png'), auto;
        }

        .lights-on {
          cursor: default !important;
        }

        .lights-on * {
          cursor: default !important;
        }

        .pulling {
          cursor: url('/hand_cursor.png'), pointer !important;
        }

        .pulling * {
          cursor: url('/hand_cursor.png'), pointer !important;
        }

        .pull-knob {
          cursor: url('/hand_cursor.png'), pointer !important;
        }

        :root {
          --mx: 50%;
          --my: 50%;
          --r: 120px;
          --feather: 90px;
          --outer: 200vmax;
        }

        .stage {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 6vh 6vw;
          position: relative;
          overflow: hidden;
        }

        .content {
          max-width: 1024px;
          line-height: 1.7;
          z-index: 1;
        }

        h1 {
          font-size: clamp(34px, 6vw, 72px);
          margin: 0.2em 0 0.4em;
        }

        p {
          margin: 0.7em 0;
          opacity: 0.92;
        }

        .mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          opacity: 0.85;
        }

        .flashlight {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 10;
          opacity: 1;
          background: radial-gradient(
            circle at var(--mx) var(--my),
            transparent 0,
            transparent calc(var(--r)),
            rgba(0, 0, 0, 0.35) calc(var(--r) + calc(var(--feather) * 0.33)),
            rgba(0, 0, 0, 0.66) calc(var(--r) + calc(var(--feather) * 0.66)),
            rgba(0, 0, 0, 0.9) calc(var(--r) + var(--feather)),
            rgba(0, 0, 0, 0.97) var(--outer)
          );
          transition: opacity 0.25s ease;
        }

        .lights-on .flashlight {
          opacity: 0 !important;
        }

        .container-wrapper {
          position: relative;
        }

        .hint {
          position: fixed;
          left: 50%;
          bottom: 24px;
          transform: translateX(-50%);
          color: #bbb;
          font-size: 12px;
          letter-spacing: 0.06em;
          opacity: 0.9;
          user-select: none;
          z-index: 20;
        }

        .pull-area {
          position: fixed;
          top: 10px;
          right: 14px;
          height: 180px;
          width: 120px;
          z-index: 30;
          pointer-events: none;
        }

        .pull-wrap {
          position: absolute;
          top: 6px;
          right: 100px;
          height: 160px;
          width: 80px;
          display: flex;
          justify-content: flex-end;
          align-items: flex-start;
          user-select: none;
          opacity: 0;
          transform: translateY(0);
          transition: opacity 0.16s ease;
        }

        .pull-wrap.armed {
          opacity: 0.05;
        }

        .pull-wrap.visible {
          opacity: 1;
          pointer-events: auto;
        }

        .pull-rope {
          position: absolute;
          top: 0;
          right: 24px;
          width: 2px;
          height: 130px;
          background: linear-gradient(#888, #aaa);
          transform-origin: top center;
          transition: transform 0.2s ease;
        }

        .pull-knob {
          position: absolute;
          bottom: 8px;
          right: 15px;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #e5e7eb;
          color: #111;
          display: grid;
          place-items: center;
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
          cursor: url('/hand_cursor.png'), pointer !important;
          transform-origin: top center;
          transition: transform 0.2s ease, background 0.2s ease, color 0.2s ease;
          font-size: 12px;
          font-weight: 700;
        }

        .bulb {
          position: absolute;
          top: -14px;
          right: 18px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #333;
          box-shadow: 0 0 0 2px #222 inset;
          transition: background 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
        }

        .lights-on .bulb {
          background: #fff;
          filter: drop-shadow(0 0 6px #fff);
          box-shadow: 0 0 0 2px #ddd inset;
        }

        @keyframes yank {
          0% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(36px);
          }
          70% {
            transform: translateY(14px);
          }
          100% {
            transform: translateY(0);
          }
        }

        @keyframes rope-stretch {
          0% {
            transform: scaleY(1);
          }
          40% {
            transform: scaleY(1.22);
          }
          70% {
            transform: scaleY(1.08);
          }
          100% {
            transform: scaleY(1);
          }
        }

        .pulling .pull-rope {
          animation: rope-stretch 0.42s ease-out;
        }

        .pulling .pull-knob {
          animation: yank 0.42s cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        .lights-on .pull-wrap {
          opacity: 0.9;
          pointer-events: auto;
        }
      `}</style>

      <div className={`container-wrapper ${lightsOn ? 'lights-on' : ''}`}>
        {/* 手电筒遮罩层 */}
        <div className="flashlight" />
        <Test />

        {/* 右上角拉绳 */}
        <div className="pull-area" ref={pullAreaRef}>
          <div
            className={`pull-wrap ${isArmed ? 'armed' : ''} ${
              isVisible ? 'visible' : ''
            } ${pulling ? 'pulling' : ''}`}
            ref={pullRef}
            role="button"
            aria-label="切换开关"
            tabIndex={0}
            onClick={toggleLights}
            onKeyDown={handlePullKeyDown}
          >
            <div className="bulb" aria-hidden="true" />
            <div className="pull-rope" aria-hidden="true" />
            <div className="pull-knob" aria-hidden="true">
              ⏻
            </div>
          </div>
        </div>

        <div className="hint">
          移动鼠标 / 触摸拖动 · Alt 放大 · Shift 缩小 · 手电筒照到右上角找拉绳
        </div>
      </div>
    </>
  );
}

