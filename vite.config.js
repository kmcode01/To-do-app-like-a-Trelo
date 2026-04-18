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
    "/projects",
    "/projects/",
    "/projects/index.html",
    "/projects/add",
    "/projects/add/",
    "/projects/add/index.html",
    "/projects/edit",
    "/projects/edit/",
    "/projects/edit/index.html",
    "/projects/view",
    "/projects/view/",
    "/projects/view/index.html",
    "/404",
    "/404.html"
  ]);

  const isInternalViteRequest = (pathname) =>
    pathname.startsWith("/@") || pathname.startsWith("/__vite");

  const getProjectViewId = (pathname) => {
    const singularMatch = pathname.match(/^\/project\/([^/]+)\/?$/);
    if (singularMatch) {
      return decodeURIComponent(singularMatch[1]);
    }

    const match = pathname.match(/^\/projects\/([^/]+)$/);

    if (!match) {
      return null;
    }

    const projectId = decodeURIComponent(match[1]);
    if (["add", "edit", "view", "index.html"].includes(projectId)) {
      return null;
    }

    return projectId;
  };

  const getProjectEditId = (pathname) => {
    const match = pathname.match(/^\/project\/([^/]+)\/edit\/?$/);

    if (!match) {
      return null;
    }

    return decodeURIComponent(match[1]);
  };

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

    if (pathname === "/projects") {
      return { url: "/projects/index.html", statusCode: null };
    }

    if (pathname === "/projects/add") {
      return { url: "/projects/add/index.html", statusCode: null };
    }

    if (pathname === "/projects/edit") {
      return { url: "/projects/edit/index.html", statusCode: null };
    }

    if (pathname === "/projects/view") {
      return { url: "/projects/view/index.html", statusCode: null };
    }

    const projectId = getProjectViewId(pathname);
    if (projectId) {
      const querySuffix = search ? `&${search}` : "";
      return {
        url: `/projects/view/index.html?id=${encodeURIComponent(projectId)}${querySuffix}`,
        statusCode: null
      };
    }

    const projectEditId = getProjectEditId(pathname);
    if (projectEditId) {
      const querySuffix = search ? `&${search}` : "";
      return {
        url: `/projects/edit/index.html?id=${encodeURIComponent(projectEditId)}${querySuffix}`,
        statusCode: null
      };
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
              !getProjectViewId(pathname) &&
              !getProjectEditId(pathname) &&
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
              !getProjectViewId(pathname) &&
              !getProjectEditId(pathname) &&
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
        register: resolve(__dirname, "register/index.html"),
        projects: resolve(__dirname, "projects/index.html"),
        projectsAdd: resolve(__dirname, "projects/add/index.html"),
        projectsEdit: resolve(__dirname, "projects/edit/index.html"),
        projectsView: resolve(__dirname, "projects/view/index.html")
      }
    }
  }
});