const btn = document.querySelector('.chat-ai-operate-button-block-v2');
btn.click();
function measureDomAppearTime(selector, interval = 50, timeout = 30000) {
  const startTime = performance.now();
  let checkTimer = null;
  let timeoutTimer = null;

  return new Promise((resolve, reject) => {
    timeoutTimer = setTimeout(() => {
      clearInterval(checkTimer);
      reject(new Error(`超时${timeout}ms未找到DOM元素: ${selector}`));
    }, timeout);
    checkTimer = setInterval(() => {
      const targetDom = document.querySelector(selector);
      
      if (targetDom) {
        clearInterval(checkTimer);
        clearTimeout(timeoutTimer);
        const costTime = performance.now() - startTime;
        resolve(Math.round(costTime * 100) / 100);
      }
    }, interval);
  });
}

measureDomAppearTime('.OrderEntry-btn')
  .then((costTime) => {
    console.log(`一键录入 出现耗时: ${costTime}ms, 出现在: ${new Date().toLocaleString()}`);
  })
  .catch((error) => {
    console.error('检测失败:', error.message);
  });