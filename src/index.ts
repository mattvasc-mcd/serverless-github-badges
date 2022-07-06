/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { githubRepoExisted } from "./github";
import { fetchBadgeURL } from "./badge";
import { increaseAndGet } from "./counter";
import Toucan from "toucan-js";
import { buildNoCacheResponseAsProxy } from "./no-cache-proxy";

export interface Env {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  VISITS_KV: KVNamespace;
  //
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // MY_DURABLE_OBJECT: DurableObjectNamespace;
  //
  // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
  // MY_BUCKET: R2Bucket;

  // There are several required secret environment variables, replace with wrangler secrets put <secret-name> before deploy your own service.
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_APP_DEFAULT_INSTALLATION_ID: string;
  SENTRY_DSN: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const sentry = new Toucan({
      dsn: env.SENTRY_DSN,
      context: ctx, // Includes 'waitUntil', which is essential for Sentry logs to be delivered. Modules workers do not include 'request' in context -- you'll need to set it separately.
      request, // request is not included in 'context', so we set it here.
      allowedHeaders: ["user-agent"],
      allowedSearchParams: /(.*)/,
    });
    try {
      const { pathname } = new URL(request.url);
      if (pathname.startsWith("/visits")) {
        const githubUsername = pathname.split("/")[2];
        const githubRepoName = pathname.split("/")[3];
        const existed = await githubRepoExisted(
          env.GITHUB_APP_ID,
          env.GITHUB_APP_PRIVATE_KEY,
          githubUsername,
          githubRepoName,
          parseInt(env.GITHUB_APP_DEFAULT_INSTALLATION_ID),
          sentry
        );
        if (existed) {
          const count = await increaseAndGet(
            `github-repo-visit-${githubUsername}-${githubRepoName}`,
            env.VISITS_KV
          );
          let query = "";
          if (request.url.includes("?")) {
            query = request.url.substring(request.url.indexOf("?"));
          }
          return await buildNoCacheResponseAsProxy(
            fetchBadgeURL("Visits", count.toString(), query)
          );
        }
        return new Response(
          `No Permission to Access GitHub Repository: ${githubUsername}/${githubRepoName}. Please Make Sure It Exists, and Installed the Github App “Serverless Github Badges” for the Private Repository.`
        );
      }
      return new Response("Serverless Badges Service with Cloudflare Workers.");
    } catch (err) {
      sentry.captureException(err);
      console.log(err);
      return new Response("Something went wrong", {
        status: 500,
        statusText: "Internal Server Error",
      });
    }
  },
};
