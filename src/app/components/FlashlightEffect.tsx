"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import HomeParticleField from "./HomeParticleField";

export default function FlashlightEffect() {
  const LIGHTS_STORAGE_KEY = "next-blog:lumi:lightsOn";
  const [lightsOn, setLightsOn] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [radius, setRadius] = useState(120);
  const [feather, setFeather] = useState(90);
  const [isVisible, setIsVisible] = useState(false);
  const [isArmed, setIsArmed] = useState(false);

  const pullRef = useRef<HTMLDivElement>(null);
  const pullAreaRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const radiusRef = useRef(120);
  const featherRef = useRef(90);

  // 半径只在按键时变化；鼠标坐标直接写 CSS，避免每帧触发 React 渲染。
  useEffect(() => {
    const root = document.documentElement;
    radiusRef.current = radius;
    featherRef.current = feather;
    root.style.setProperty("--r", `${radius}px`);
    root.style.setProperty("--feather", `${feather}px`);
  }, [radius, feather]);

  // 初始化位置和 body 样式
  useEffect(() => {
    if (typeof window !== "undefined") {
      document.documentElement.style.setProperty(
        "--mx",
        `${window.innerWidth / 2}px`,
      );
      document.documentElement.style.setProperty(
        "--my",
        `${window.innerHeight / 2}px`,
      );

      // 添加 body 类名来应用样式
      document.body.classList.add("flashlight-page");

      // 恢复灯光状态缓存（用于路由切换后回到首页不“重回黑暗”）
      try {
        const cached = window.localStorage.getItem(LIGHTS_STORAGE_KEY);
        const cachedOn = cached === "1";
        if (cachedOn) {
          setLightsOn(true);
          setIsVisible(true);
          setIsArmed(false);
          document.body.classList.add("lights-on");
        }
      } catch {
        // ignore (Safari private mode / storage blocked)
      }

      return () => {
        // 清理类名（注意：不移除 lights-on，这样点亮后跳转页面导航仍然可见）
        document.body.classList.remove("flashlight-page", "pulling");
      };
    }
  }, []);

  // 更新 body 类名
  useEffect(() => {
    if (lightsOn) {
      document.body.classList.add("lights-on");
    } else {
      document.body.classList.remove("lights-on");
    }
  }, [lightsOn]);

  // 缓存灯光状态
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LIGHTS_STORAGE_KEY, lightsOn ? "1" : "0");
    } catch {
      // ignore
    }
  }, [lightsOn]);

  useEffect(() => {
    if (pulling) {
      document.body.classList.add("pulling");
    } else {
      document.body.classList.remove("pulling");
    }
  }, [pulling]);

  // 鼠标移动
  useEffect(() => {
    const update = (x: number, y: number) => {
      const root = document.documentElement;
      root.style.setProperty("--mx", `${x}px`);
      root.style.setProperty("--my", `${y}px`);
      if (pendingRef.current || document.body.classList.contains("lights-on"))
        return;
      pendingRef.current = true;
      requestAnimationFrame(() => {
        const rect = pullAreaRef.current?.getBoundingClientRect();
        if (rect) {
          const near =
            Math.hypot(x - (rect.right - 30), y - (rect.top + 100)) <=
            radiusRef.current + featherRef.current * 0.55;
          setIsVisible((old) => (old === near ? old : near));
          setIsArmed((old) => (old === !near ? old : !near));
        }
        pendingRef.current = false;
      });
    };
    const handleMouseMove = (e: MouseEvent) => update(e.clientX, e.clientY);

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        update(touch.clientX, touch.clientY);
      }
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
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
      if (e.key === "Alt" || e.key === "Meta") {
        setRadius(220);
        setFeather(140);
      } else if (e.key === "Shift") {
        setRadius(90);
        setFeather(70);
      } else if (e.key.toLowerCase() === "l") {
        toggleLights();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" || e.key === "Meta" || e.key === "Shift") {
        setRadius(120);
        setFeather(90);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [toggleLights]);

  const handlePullKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleLights();
    }
  };

  return (
    <>
      <div className={`container-wrapper ${lightsOn ? "lights-on" : ""}`}>
        <HomeParticleField lightsOn={lightsOn} />
        {/* 手电筒遮罩层 */}
        <div className="flashlight" />
        {/* 右上角拉绳 */}
        <div className="pull-area" ref={pullAreaRef}>
          <div
            className={`pull-wrap ${isArmed ? "armed" : ""} ${
              isVisible ? "visible" : ""
            } ${pulling ? "pulling" : ""}`}
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
          <span>SCROLL TO GATHER</span>移动探索 · Alt 放大 · Shift 缩小 · L
          开关灯
        </div>
      </div>
    </>
  );
}
