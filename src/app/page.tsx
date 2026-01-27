import FlashlightEffect from './components/FlashlightEffect';

export default function Home() {
  return (
    <div className="stage">
      <div className="content">
        <h1>欢迎来到绿桶的小世界</h1>
        <p>Welcome to the world of Green Bucket</p>
        <p className="mono">
          Alt 放大 · Shift 缩小 · 键盘 L 快捷开/关灯
        </p>
      </div>
      <FlashlightEffect />
    </div>
  );
}
