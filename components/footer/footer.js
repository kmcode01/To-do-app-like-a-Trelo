import template from "./footer.html?raw";
import "./footer.css";

export function renderFooter(target) {
  if (!target) {
    return;
  }

  target.innerHTML = template;
}