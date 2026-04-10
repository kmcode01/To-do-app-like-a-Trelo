import { renderFooter } from "../../components/footer/footer.js";
import { renderHeader } from "../../components/header/header.js";
import "./index.css";

document.title = "TaskFlow | Dashboard";

const app = document.querySelector("#app");

app.innerHTML = `
  <div class="page-shell">
    <div data-header></div>
    <main class="page-content">
      <h1>Dashboard</h1>
      <p>
        This page is mapped to <strong>/dashboard</strong> and can host board summaries,
        project links, and quick actions.
      </p>
      <a class="secondary-link" href="/">Back to Home</a>
    </main>
    <div data-footer></div>
  </div>
`;

renderHeader(document.querySelector("[data-header]"), "/dashboard");
renderFooter(document.querySelector("[data-footer]"));