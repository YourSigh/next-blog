function getData(a) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve(a);
    });
  });
}

let count = 0;
async function solve(num) {
  let res = await getData(num);
  count += res;
}
solve(1);
solve(2);
setTimeout(() => {
  console.log("count", count);
}, 1000);