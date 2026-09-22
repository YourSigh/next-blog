"use strict";

// Next.js standalone creates its HTTP server internally, before application
// code has a chance to configure it. Node defaults requestTimeout to five
// minutes, which is too short for a streamed APK upload from GitHub Actions.
const DEFAULT_REQUEST_TIMEOUT_MS = 35 * 60 * 1000;
const ENVIRONMENT_VARIABLE = "NEXT_SERVER_REQUEST_TIMEOUT_MS";

function getRequestTimeout() {
  const configured = process.env[ENVIRONMENT_VARIABLE];
  if (!configured) return DEFAULT_REQUEST_TIMEOUT_MS;

  const timeout = Number(configured);
  if (Number.isSafeInteger(timeout) && timeout > 0) return timeout;

  console.warn(
    `[server-timeouts] Ignoring invalid ${ENVIRONMENT_VARIABLE}=${JSON.stringify(configured)}; using ${DEFAULT_REQUEST_TIMEOUT_MS}ms.`,
  );
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

const requestTimeout = getRequestTimeout();

function configureCreateServer(createServer) {
  return function createServerWithRequestTimeout(...args) {
    const firstArgument = args[0];
    const options =
      typeof firstArgument === "function" || firstArgument == null
        ? {}
        : firstArgument;
    const requestListener =
      typeof firstArgument === "function" ? firstArgument : args[1];

    // Node reads requestTimeout while constructing its HTTP parser. Setting the
    // property after createServer() only changes the displayed value; it does
    // not change the parser's timeout behavior for future connections.
    return createServer.call(
      this,
      { ...options, requestTimeout },
      requestListener,
    );
  };
}

for (const protocol of [require("node:http"), require("node:https")]) {
  protocol.createServer = configureCreateServer(protocol.createServer);
}

console.info(
  `[server-timeouts] HTTP request timeout set to ${requestTimeout}ms.`,
);
