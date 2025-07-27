export const api = new sst.aws.ApiGatewayV2("Api");

api.route("GET /", {
  handler: "packages/functions/src/api.handler",
});
