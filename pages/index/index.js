import { renderFooter } from "../../components/footer/footer.js";
import { renderHeader } from "../../components/header/header.js";
import "./index.css";

document.title = "TaskFlow | Home";

const app = document.querySelector("#app");

app.innerHTML = `
  <div class="page-shell">
    <div data-header></div>
    <main class="page-content">
      <h1>Welcome</h1>
      <p>
        This is the landing page at <strong>/</strong>. Future routes can be added for
        login, register, projects, project details, and tasks.
      </p>
      <a class="primary-link" href="/dashboard">Go to Dashboard</a>
    </main>
    <div data-footer></div>
  </div>
`;

renderHeader(document.querySelector("[data-header]"), "/");
renderFooter(document.querySelector("[data-footer]"));