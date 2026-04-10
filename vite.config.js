import { resolve } from "node:path";
import { defineConfig } from "vite";

function routeAliasPlugin() {
  const rewriteDashboardPath = (url) => {
    if (url === "/dashboard") {
      return "/dashboard/index.html";
    }

    return url;
  };

  return {
    name: "route-alias-plugin",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url) {
          req.url = rewriteDashboardPath(req.url);
        }

        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url) {
          req.url = rewriteDashboardPath(req.url);
        }

        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [routeAliasPlugin()],
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, "index.html"),
        dashboard: resolve(__dirname, "dashboard/index.html")
      }
    }
  }
});