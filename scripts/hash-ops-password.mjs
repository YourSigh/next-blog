import { hash } from "@node-rs/argon2";

const password = process.argv[2];

if (!password || password.length < 12) {
  console.error("用法：npm run ops:hash-password -- '至少 12 位的密码'");
  process.exit(1);
}

const encoded = await hash(password, {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

console.log(encoded);
