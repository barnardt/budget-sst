/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "budget-sst",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: {
          profile: input.stage === "production" ? "ignatius-personal" : "ignatius-personal"
        }
      }
    };
  },
  async run() {
    await import("./infra/api");
  },
});
