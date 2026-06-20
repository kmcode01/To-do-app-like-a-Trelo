import { renderFooter } from "../../../components/footer/footer.js";
import { renderHeader } from "../../../components/header/header.js";
import { requireAuthenticatedSession, supabase } from "../../lib/supabaseClient.js";
import "../../theme.css";
import "../shared.css";

document.title = "TaskFlow | Add Project";

const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatRole(role) {
  return role === "owner" ? "Owner" : "Member";
}

function renderMembersRows(members, appUsersById, currentUserId) {
  if (!members.length) {
    return "<tr><td colspan=\"5\" class=\"empty-state\">No users assigned yet.</td></tr>";
  }

  return members
    .map((member) => {
      const appUser = appUsersById.get(member.user_id);
      const displayName =
        member.user_name || appUser?.display_name || appUser?.email || "Unnamed member";
      const displayEmail = appUser?.email || "-";
      const roleLabel = formatRole(member.role);
      const isSelf = member.user_id === currentUserId;
      const selfBadge = isSelf ? "<span class=\"member-tag is-self\">You</span>" : "";
      const roleBadge = member.role === "owner" ? "<span class=\"member-tag\">Owner</span>" : "";
      const actions =
        member.role !== "owner"
          ? `<button class="danger-link" type="button" data-remove-member-id="${member.user_id}">Remove</button>`
          : "";

      return `
        <tr>
          <td>
            <div class="member-id">
              <span>${escapeHtml(displayName)}</span>
              ${selfBadge}
              ${roleBadge}
            </div>
          </td>
          <td>${escapeHtml(displayEmail)}</td>
          <td>${roleLabel}</td>
          <td>${formatDate(member.created_at)}</td>
          <td class="actions-cell">${actions}</td>
        </tr>
      `;
    })
    .join("");
}

function renderUserList(users, membersSet, filterText) {
  const query = String(filterText || "").trim().toLowerCase();
  const filtered = users.filter((user) => {
    if (!query) {
      return true;
    }

    const name = String(user.display_name || "").toLowerCase();
    const email = String(user.email || "").toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  if (!filtered.length) {
    return "<p class=\"empty-state\">No users found.</p>";
  }

  return filtered
    .map((user) => {
      const isAssigned = membersSet.has(user.id);
      const label = user.display_name || user.email || "Unnamed user";
      return `
        <div class="user-row">
          <div class="user-meta">
            <span class="user-name">${escapeHtml(label)}</span>
            <span class="user-email">${escapeHtml(user.email || "-")}</span>
          </div>
          <button class="btn-soft" type="button" data-add-user-id="${user.id}" ${
            isAssigned ? "disabled" : ""
          }>
            ${isAssigned ? "Added" : "Add"}
          </button>
        </div>
      `;
    })
    .join("");
}

async function bootstrap() {
  const session = await requireAuthenticatedSession("/login");

  if (!session) {
    return;
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token
  });

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  const userId = session.user?.id;
  if (!userId) {
    throw new Error("Could not resolve current user.");
  }

  const { data: users, error: usersError } = await supabase.rpc("list_app_users");

  if (usersError) {
    throw new Error(usersError.message);
  }

  const appUsers = users || [];
  const appUsersById = new Map(appUsers.map((user) => [user.id, user]));
  const ownerProfile = appUsersById.get(userId);
  const ownerName =
    ownerProfile?.display_name || ownerProfile?.email || session.user?.email || "Owner";
  let memberRows = [
    {
      user_id: userId,
      role: "owner",
      created_at: new Date().toISOString(),
      user_name: ownerName
    }
  ];
  let membersSet = new Set(memberRows.map((member) => member.user_id));

  app.innerHTML = `
    <div class="page-shell">
      <div data-header></div>
      <main class="page-content">
        <div class="page-head">
          <h1>Add Project</h1>
        </div>

        <form class="form-card" data-project-form novalidate>
          <div class="field">
            <label for="title">Title</label>
            <input id="title" name="title" type="text" maxlength="120" required />
          </div>

          <div class="field">
            <label for="description">Description</label>
            <textarea id="description" name="description" maxlength="1000"></textarea>
          </div>

          <div class="form-actions">
            <button class="btn-primary" type="submit" data-submit-btn>Create</button>
            <a class="action-link" href="/projects">Back to Projects</a>
          </div>

          <p class="message" data-message role="status" aria-live="polite"></p>
        </form>

        <section class="detail-card members-card" aria-label="Project users">
          <div class="section-head">
            <div>
              <h2>Project Users</h2>
              <p class="section-subtitle">Assign users who should access this project.</p>
            </div>
            <button class="btn-primary" type="button" data-open-add>Add user</button>
          </div>

          <div class="table-wrap">
            <table class="projects-table members-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Added</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody data-members-body>
                ${renderMembersRows(memberRows, appUsersById, userId)}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <div data-footer></div>
    </div>

    <dialog class="members-dialog" data-add-dialog>
      <div class="dialog-body">
        <div class="dialog-head">
          <h2>Add user</h2>
          <button class="icon-btn" type="button" data-close-add aria-label="Close">
            &times;
          </button>
        </div>
        <div class="field">
          <label for="user-search">Search users</label>
          <input id="user-search" name="userSearch" type="search" autocomplete="off" placeholder="Search by name or email" />
        </div>
        <div class="user-list" data-user-list>
          ${renderUserList(appUsers, membersSet)}
        </div>
        <p class="message" data-add-message role="status" aria-live="polite"></p>
      </div>
    </dialog>

    <dialog class="delete-dialog" data-remove-dialog>
      <div class="dialog-body">
        <h2>Remove user</h2>
        <p data-remove-message>Are you sure you want to remove this user?</p>
        <div class="dialog-actions">
          <button class="btn-secondary" type="button" data-cancel-remove>Cancel</button>
          <button class="btn-danger" type="button" data-confirm-remove>Remove</button>
        </div>
      </div>
    </dialog>
  `;

  renderHeader(document.querySelector("[data-header]"), "/projects");
  renderFooter(document.querySelector("[data-footer]"));

  const form = document.querySelector("[data-project-form]");
  const submitBtn = document.querySelector("[data-submit-btn]");
  const messageEl = document.querySelector("[data-message]");
  const membersBody = document.querySelector("[data-members-body]");
  const addDialog = document.querySelector("[data-add-dialog]");
  const addButton = document.querySelector("[data-open-add]");
  const addMessage = document.querySelector("[data-add-message]");
  const closeAddButton = document.querySelector("[data-close-add]");
  const userList = document.querySelector("[data-user-list]");
  const searchInput = document.querySelector("#user-search");
  const removeDialog = document.querySelector("[data-remove-dialog]");
  const removeMessage = document.querySelector("[data-remove-message]");
  const confirmRemoveButton = document.querySelector("[data-confirm-remove]");
  const cancelRemoveButton = document.querySelector("[data-cancel-remove]");
  let pendingRemoveId = null;

  function refreshMembersView() {
    membersSet = new Set(memberRows.map((member) => member.user_id));
    if (membersBody) {
      membersBody.innerHTML = renderMembersRows(memberRows, appUsersById, userId);
    }
    if (userList) {
      userList.innerHTML = renderUserList(appUsers, membersSet, searchInput?.value || "");
    }
  }

  if (addButton && addDialog) {
    addButton.addEventListener("click", () => {
      if (addMessage) {
        addMessage.classList.remove("is-error");
        addMessage.textContent = "";
      }
      addDialog.showModal();
      if (searchInput) {
        searchInput.value = "";
        searchInput.focus();
      }
      refreshMembersView();
    });
  }

  if (closeAddButton && addDialog) {
    closeAddButton.addEventListener("click", () => {
      addDialog.close();
    });
  }

  if (searchInput && userList) {
    searchInput.addEventListener("input", () => {
      userList.innerHTML = renderUserList(appUsers, membersSet, searchInput.value);
    });
  }

  if (userList) {
    userList.addEventListener("click", (event) => {
      const target = event.target.closest("[data-add-user-id]");
      if (!target) {
        return;
      }

      const memberId = target.getAttribute("data-add-user-id");
      if (!memberId || membersSet.has(memberId)) {
        return;
      }

      const appUser = appUsersById.get(memberId);
      const userName = appUser?.display_name || appUser?.email || "Unnamed member";

      memberRows = [
        ...memberRows,
        {
          user_id: memberId,
          role: "member",
          created_at: new Date().toISOString(),
          user_name: userName
        }
      ];

      if (addMessage) {
        addMessage.classList.remove("is-error");
        addMessage.textContent = "User added.";
      }

      refreshMembersView();
    });
  }

  if (membersBody) {
    membersBody.addEventListener("click", (event) => {
      const target = event.target.closest("[data-remove-member-id]");
      if (!target) {
        return;
      }

      const memberId = target.getAttribute("data-remove-member-id");
      if (!memberId) {
        return;
      }

      pendingRemoveId = memberId;
      if (removeMessage) {
        removeMessage.textContent = "Are you sure you want to remove this user?";
      }
      removeDialog?.showModal();
    });
  }

  if (cancelRemoveButton && removeDialog) {
    cancelRemoveButton.addEventListener("click", () => {
      pendingRemoveId = null;
      removeDialog.close();
    });
  }

  if (confirmRemoveButton && removeDialog) {
    confirmRemoveButton.addEventListener("click", () => {
      if (!pendingRemoveId) {
        removeDialog.close();
        return;
      }

      confirmRemoveButton.disabled = true;
      confirmRemoveButton.textContent = "Removing...";

      memberRows = memberRows.filter(
        (member) => !(member.user_id === pendingRemoveId && member.role !== "owner")
      );

      confirmRemoveButton.disabled = false;
      confirmRemoveButton.textContent = "Remove";

      pendingRemoveId = null;
      removeDialog.close();
      refreshMembersView();
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();

    messageEl.classList.remove("is-error");
    messageEl.textContent = "";

    if (!title) {
      messageEl.textContent = "Title is required.";
      messageEl.classList.add("is-error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";

    const { data: projectId, error } = await supabase.rpc("create_project", {
      p_title: title,
      p_description: description || null
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Create";

    if (error) {
      messageEl.textContent = error.message;
      messageEl.classList.add("is-error");
      return;
    }

    const membersToInsert = memberRows
      .filter((member) => member.role !== "owner")
      .map((member) => ({
        project_id: projectId,
        user_id: member.user_id,
        role: "member",
        added_by_user_id: userId,
        user_name: member.user_name
      }));

    if (projectId && membersToInsert.length) {
      const { error: membersError } = await supabase
        .from("project_members")
        .insert(membersToInsert);

      if (membersError) {
        messageEl.classList.add("is-error");
        messageEl.innerHTML = `Project created, but adding members failed. <a class="action-link" href="/project/${projectId}/edit">Open project</a>.`;
        submitBtn.disabled = false;
        submitBtn.textContent = "Create";
        return;
      }
    }

    messageEl.classList.remove("is-error");
    messageEl.textContent = "Project created. Redirecting...";
    setTimeout(() => {
      window.location.replace(`/project/${projectId}`);
    }, 800);
  });
}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${escapeHtml(error.message)}</p>`;
});
