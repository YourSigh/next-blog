"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
const vertex = `uniform float time,morph,ratio,light;uniform vec2 mouse;attribute vec3 target,tint;attribute float scale,seed;varying vec3 c;varying float a;varying float starScale;void main(){float e=morph*morph*(3.-2.*morph);vec3 p=mix(position+vec3(sin(position.y*.4+time*.3+seed)*.55,cos(position.x*.3-time*.24+seed)*.42,sin(position.y*.2+seed)*.55),target,e);vec2 d=p.xy-mouse;float f=exp(-dot(d,d)*.45)*.32;p.xy+=normalize(vec2(-d.y,d.x)+.001)*f;vec4 v=modelViewMatrix*vec4(p,1);gl_Position=projectionMatrix*v;gl_PointSize=min(18.,scale*ratio*82./max(1.,-v.z));c=tint;a=mix(1.,.64,light)*mix(.3,.78,e);starScale=scale;}`;
const fragment = `varying vec3 c;varying float a;varying float starScale;void main(){vec2 uv=gl_PointCoord-.5;float d=length(uv),core=1.-smoothstep(.025,.16,d),halo=1.-smoothstep(.08,.5,d);float rays=(1.-smoothstep(.015,.065,abs(uv.x)))+(1.-smoothstep(.015,.065,abs(uv.y)));float large=smoothstep(4.5,8.,starScale);float x=(core+halo*.3+rays*.14*large)*a;if(x<.018)discard;float l=dot(c,vec3(.299,.587,.114));vec3 silver=mix(vec3(.56,.59,.64),vec3(1.),l);gl_FragColor=vec4(mix(silver,vec3(1),core*.45),x);}`;
export default function HomeParticleField({ lightsOn }: { lightsOn: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null),
    lit = useRef(lightsOn);
  useEffect(() => {
    lit.current = lightsOn;
  }, [lightsOn]);
  useEffect(() => {
    if (!ref.current) return;
    let disposed = false,
      cleanup = () => {};
    const image = new Image();
    image.src = "/nahida-line-particle-source.png";
    image.onload = () => {
      if (disposed) return;
      const mobile = innerWidth < 700,
        count = mobile ? 3000 : 5500,
        s = document.createElement("canvas");
      s.width = s.height = 256;
      const ctx = s.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0, 256, 256);
      const data = ctx.getImageData(0, 0, 256, 256).data,
        valid: number[] = [];
      for (let i = 0; i < 65536; i++) if (data[i * 4 + 3] > 55) valid.push(i);
      for (let i = valid.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [valid[i], valid[j]] = [valid[j], valid[i]];
      }
      const pos = new Float32Array(count * 3),
        target = new Float32Array(count * 3),
        color = new Float32Array(count * 3),
        size = new Float32Array(count),
        seed = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const j = i * 3,
          ang = Math.random() * 6.283,
          r = Math.pow(Math.random(), 0.58) * 19;
        pos.set(
          [
            Math.cos(ang) * r + (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 18,
            Math.sin(ang) * r * 0.6 + (Math.random() - 0.5) * 10,
          ],
          j,
        );
        const k = valid[i % valid.length],
          ix = k % 256,
          iy = Math.floor(k / 256),
          p = k * 4;
        target.set(
          [
            (ix / 255 - 0.5) * (mobile ? 11 : 12) + (mobile ? 0 : 3.6),
            -(iy / 255 - 0.5) * (mobile ? 11 : 12),
            (Math.random() - 0.5) * 0.5,
          ],
          j,
        );
        color.set([data[p] / 255, data[p + 1] / 255, data[p + 2] / 255], j);
        const starClass = Math.random();
        size[i] =
          starClass < 0.01
            ? 8 + Math.random() * 5
            : starClass < 0.085
              ? 3.2 + Math.random() * 3.2
              : 0.55 + Math.random() * 1.05;
        seed[i] = Math.random() * 6.283;
      }
      const renderer = new THREE.WebGLRenderer({
        canvas: ref.current!,
        alpha: true,
        powerPreference: "low-power",
        antialias: false,
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1 : 1.25));
      const scene = new THREE.Scene(),
        camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
      camera.position.z = 24;
      const geometry = new THREE.BufferGeometry();
      [
        ["position", pos, 3],
        ["target", target, 3],
        ["tint", color, 3],
        ["scale", size, 1],
        ["seed", seed, 1],
      ].forEach(([n, v, k]) =>
        geometry.setAttribute(
          n as string,
          new THREE.BufferAttribute(v as Float32Array, k as number),
        ),
      );
      const u = {
          time: { value: 0 },
          morph: { value: 0 },
          ratio: { value: renderer.getPixelRatio() },
          light: { value: lightsOn ? 1 : 0 },
          mouse: { value: new THREE.Vector2(99, 99) },
        },
        material = new THREE.ShaderMaterial({
          uniforms: u,
          vertexShader: vertex,
          fragmentShader: fragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
        points = new THREE.Points(geometry, material);
      scene.add(points);
      let goal = 0,
        id = 0,
        last = 0,
        prev = performance.now(),
        pointer = new THREE.Vector2(99, 99),
        visible = true;
      const resize = () => {
          renderer.setSize(innerWidth, innerHeight, false);
          camera.aspect = innerWidth / innerHeight;
          camera.updateProjectionMatrix();
        },
        smooth = (a: number, b: number, v: number) => {
          let x = Math.max(0, Math.min(1, (v - a) / (b - a)));
          return x * x * (3 - 2 * x);
        },
        scroll = () => {
          const max = document.documentElement.scrollHeight - innerHeight,
            v = max ? scrollY / max : 0;
          goal = smooth(0.1, 0.38, v) * (1 - smooth(0.68, 0.95, v));
        },
        move = (e: PointerEvent) =>
          pointer.set(
            (e.clientX / innerWidth - 0.5) * 24,
            -(e.clientY / innerHeight - 0.5) * 14,
          ),
        visibility = () => {
          visible = !document.hidden;
        },
        loop = (now: number) => {
          id = requestAnimationFrame(loop);
          const interval = lit.current ? 42 : 25;
          if (!visible || now - last < interval) return;
          last = now;
          u.time.value += Math.min((now - prev) / 1000, 0.05);
          prev = now;
          u.morph.value += (goal - u.morph.value) * 0.09;
          u.light.value += ((lit.current ? 1 : 0) - u.light.value) * 0.1;
          u.mouse.value.lerp(pointer, 0.22);
          renderer.render(scene, camera);
        };
      resize();
      scroll();
      addEventListener("resize", resize);
      addEventListener("scroll", scroll, { passive: true });
      addEventListener("pointermove", move, { passive: true });
      document.addEventListener("visibilitychange", visibility);
      id = requestAnimationFrame(loop);
      cleanup = () => {
        cancelAnimationFrame(id);
        removeEventListener("resize", resize);
        removeEventListener("scroll", scroll);
        removeEventListener("pointermove", move);
        document.removeEventListener("visibilitychange", visibility);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
      };
    };
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);
  return (
    <canvas ref={ref} className="home-particle-field" aria-hidden="true" />
  );
}
