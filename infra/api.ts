export const api = new sst.aws.ApiGatewayV2("Api");

api.route("GET /health", {
  handler: "packages/functions/src/health.handler",
});

api.route("POST /budget-email", {
  handler: "packages/functions/src/budget-email.handler",
});