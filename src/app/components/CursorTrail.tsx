'use client';

import { useEffect, useRef } from 'react';

export default function CursorTrail() {
  const trailRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Array<{ element: HTMLDivElement; x: number; y: number; opacity: number }>>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const container = trailRef.current;
    if (!container) return;

    // 创建拖尾粒子
    const createParticle = (x: number, y: number) => {
      const particle = document.createElement('div');
      particle.className = 'cursor-trail-particle';
      particle.style.left = `${x}px`;
      particle.style.top = `${y}px`;
      container.appendChild(particle);

      const particleData = {
        element: particle,
        x,
        y,
        opacity: 1,
      };

      particlesRef.current.push(particleData);

      // 动画：淡出并放大
      let opacity = 1;
      let scale = 0.5;
      const duration = 500; // 500ms 动画时长
      const startTime = Date.now();

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // 缓动函数：ease-out
        const easeOut = 1 - Math.pow(1 - progress, 3);

        opacity = 1 - easeOut;
        scale = 0.5 + easeOut * 1.5;

        particle.style.opacity = String(opacity);
        particle.style.transform = `translate(-50%, -50%) scale(${scale})`;

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          // 动画结束后移除元素
          particle.remove();
          particlesRef.current = particlesRef.current.filter((p) => p.element !== particle);
        }
      };

      requestAnimationFrame(animate);
    };

    let lastX = 0;
    let lastY = 0;
    let lastTime = 0;
    const throttleDelay = 16; // 约 60fps

    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastTime < throttleDelay) return;
      lastTime = now;

      const { clientX, clientY } = e;

      // 计算移动距离，只在移动足够远时创建新粒子
      const dx = clientX - lastX;
      const dy = clientY - lastY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 5) {
        createParticle(clientX, clientY);
        lastX = clientX;
        lastY = clientY;
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      // 清理所有粒子
      particlesRef.current.forEach((p) => p.element.remove());
      particlesRef.current = [];
    };
  }, []);

  return <div ref={trailRef} className="cursor-trail-container" />;
}
