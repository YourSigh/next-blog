import FlashlightEffect from "./components/FlashlightEffect";

export default function Home() {
  return (
    <div className="stage">
      <div className="forest-glow" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="content">
        <p className="hero-kicker">GREEN BUCKET · DIGITAL GARDEN</p>
        <h1>
          欢迎来到
          <br />
          <em>绿桶的小世界</em>
        </h1>
        <p className="hero-lead">
          一些代码、灵感和微小发现，
          <br />
          在这里慢慢生长。
        </p>
        <p className="mono">向下滚动，让散落的星光显形</p>
      </div>
      <FlashlightEffect />
    </div>
  );
}
