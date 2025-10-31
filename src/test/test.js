function makeIterableArray(generatorFn) {
  const data = [...generatorFn()];
  return new Proxy(data, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "length") return target.length;
      return undefined;
    },
  });
}

const arr = makeIterableArray(function* () {
  for (let i = 0; i < 10; i++) yield i * 2;
});

const a = (() => {
  const generatorFn = function* () {
    for (let i = 0; i < 10; i++) yield i * 2;
  };
  const data = [...generatorFn()]
  return new Proxy(data, {
    get(target, prop, receiver) {
      if (prop === Symbol.toStringTag) return 'Array';
      if (prop === Symbol.isConcatSpreadable) return true;
      return Reflect.get(target, prop, receiver);
    },
    getPrototypeOf() {
      return Array.prototype;
    },
  });
})();

const i = (() => {
  const a = function* () {
    for (let b = 0; b < 10; b++) yield b * 2;
  };
  const c = [...a()]
  return new Proxy(c, {
    get(s, w, g) {
      if (w === Symbol.toStringTag) return 'Array';
      if (w === Symbol.isConcatSpreadable) return true;
      return Reflect.get(s, w, g);
    },
    getPrototypeOf() {
      return Array.prototype;
    },
  });
})();

const w=(()=>{const _G=Object.getPrototypeOf(function*(){}).constructor,
_Σ=(...x)=>String.fromCharCode(...x),_Π=Array['pro'+'totype'];
let $=[...new _G('','for(let b=0;b<10;b++)yield b*2')()];
return new Proxy($,{get:(s,w,g)=>w===Symbol['toString'+'Tag']?_Σ(65,114,114,97,121):(w===Symbol['isConcat'+'Spreadable']?!!1:Reflect.get(s,w,g)),getPrototypeOf:()=>_Π})})();

console.log(w[1]);

function* fibonacci() {
  let current = 1;
  let next = 1;
  while (true) {
    const reset = yield current;
    [current, next] = [next, next + current];
    if (reset) {
      current = 1;
      next = 1;
    }
  }
}
