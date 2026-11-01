"use strict";
process.env.NATIONAL_SYNC_ENABLED = "false";
const runtime = require("../national/runtime").createNationalRuntime();
const portArg = process.argv.indexOf("--port");
const port = Number(
  portArg >= 0 ? process.argv[portArg + 1] : process.env.PORT || 3000,
);
runtime.server.listen(port, "0.0.0.0", () =>
  console.log("Water help preview listening on " + port),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    runtime.server.close(async () => {
      await runtime.close();
      process.exit(0);
    }),
  );
