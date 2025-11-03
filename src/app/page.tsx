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
        <p>
          这是更"彩蛋感"的版本：拉绳平时埋在暗处，只有聚光照过去才能发现。点击还带有向下拉的回弹动画。
        </p>
      </div>
      <FlashlightEffect />
    </div>
  );
}
