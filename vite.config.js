import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

function routeAliasPlugin() {
  const knownPaths = new Set([
    "/",
    "/index.html",
    "/dashboard",
    "/dashboard/",
    "/dashboard/index.html",
    "/login",
    "/login/",
    "/login/index.html",
    "/register",
    "/register/",
    "/register/index.html",
    "/404",
    "/404.html"
  ]);

  const isInternalViteRequest = (pathname) =>
    pathname.startsWith("/@") || pathname.startsWith("/__vite");

  const notFoundPageHtml = readFileSync(resolve(__dirname, "404.html"), "utf-8");

  const rewriteRoutePath = (url) => {
    const [pathname, search = ""] = url.split("?");

    if (pathname === "/dashboard") {
      return { url: "/dashboard/index.html", statusCode: null };
    }

    if (pathname === "/login") {
      return { url: "/login/index.html", statusCode: null };
    }

    if (pathname === "/register") {
      return { url: "/register/index.html", statusCode: null };
    }

    if (knownPaths.has(pathname) || pathname.includes(".") || isInternalViteRequest(pathname)) {
      return { url, statusCode: null };
    }

    const querySuffix = search ? `?${search}` : "";
    return { url: `/404.html${querySuffix}`, statusCode: 404 };
  };

  return {
    name: "route-alias-plugin",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url) {
          const method = req.method?.toUpperCase();
          if (method === "GET" || method === "HEAD") {
            const [pathname] = req.url.split("?");

            if (
              !knownPaths.has(pathname) &&
              !pathname.includes(".") &&
              !isInternalViteRequest(pathname)
            ) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "text/html; charset=utf-8");

              if (method === "HEAD") {
                res.end();
              } else {
                res.end(notFoundPageHtml);
              }

              return;
            }
          }

          const { url, statusCode } = rewriteRoutePath(req.url);
          req.url = url;

          if (statusCode) {
            res.statusCode = statusCode;
          }
        }

        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url) {
          const method = req.method?.toUpperCase();
          if (method === "GET" || method === "HEAD") {
            const [pathname] = req.url.split("?");

            if (
              !knownPaths.has(pathname) &&
              !pathname.includes(".") &&
              !isInternalViteRequest(pathname)
            ) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "text/html; charset=utf-8");

              if (method === "HEAD") {
                res.end();
              } else {
                res.end(notFoundPageHtml);
              }

              return;
            }
          }

          const { url, statusCode } = rewriteRoutePath(req.url);
          req.url = url;

          if (statusCode) {
            res.statusCode = statusCode;
          }
        }

        next();
      });
    }
  };
}

export default defineConfig({
  envPrefix: ["VITE_", "SUPABASE_"],
  plugins: [routeAliasPlugin()],
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, "index.html"),
        notFound: resolve(__dirname, "404.html"),
        dashboard: resolve(__dirname, "dashboard/index.html"),
        login: resolve(__dirname, "login/index.html"),
        register: resolve(__dirname, "register/index.html")
      }
    }
  }
});