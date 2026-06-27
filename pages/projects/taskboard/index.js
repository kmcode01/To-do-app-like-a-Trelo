import { renderFooter } from "../../../components/footer/footer.js";
import { renderHeader } from "../../../components/header/header.js";
import { createTaskEditor, renderTaskEditorDialog } from "../../../components/task-editor/task-editor.js";
import { requireAuthenticatedSession, supabase } from "../../../lib/supabaseClient.js";
import { showToast } from "../../../lib/toast.js";
import "../../../styles/theme.css";
import "../shared.css";
import "./index.css";

document.title = "TaskFlow | Taskboard";

const app = document.querySelector("#app");
const dragState = { sourceStageId: null };

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, "");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function resolveDisplayName(user) {
  if (!user) {
    return "Unknown";
  }

  return user.display_name || user.email || "Unknown";
}

function getInitials(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "?";
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveDeadlineState(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadlineDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((deadlineDay - today) / 86400000);
  if (diffDays < 0) return { label: `Overdue ${Math.abs(diffDays)}d`, state: "overdue" };
  if (diffDays === 0) return { label: "Due today", state: "today" };
  if (diffDays <= 3) return { label: `Due in ${diffDays}d`, state: "soon" };
  return { label: date.toLocaleDateString(), state: "ok" };
}

function toDateInputValue(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function formatSeconds(totalSeconds) {
  const n = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const REACTION_OPTIONS = ["👍", "❤️", "🎉"];

function buildMemberLabel(member) {
  return member?.display_name || member?.email || "";
}

function extractMentions(content, members = []) {
  const normalizedContent = String(content || "").toLowerCase();
  const unique = new Map();

  members.forEach((member) => {
    const label = buildMemberLabel(member);
    if (!label) {
      return;
    }

    const token = `@${label}`.toLowerCase();
    if (normalizedContent.includes(token)) {
      unique.set(member.id, { mentioned_user_id: member.id, mention_text: label });
    }
  });

  return [...unique.values()];
}

function renderCommentContent(value, mentions = []) {
  let safe = escapeHtml(value || "").replace(/\n/g, "<br />");

  if (!mentions.length) {
    return safe;
  }

  const replacements = mentions
    .map((mention) => {
      const original = mention.mention_text || resolveDisplayName(mention.app_users);
      const currentLabel = resolveDisplayName(mention.app_users) || original;
      return {
        original: escapeHtml(original),
        currentLabel: escapeHtml(currentLabel)
      };
    })
    .filter((item) => item.original)
    .sort((a, b) => b.original.length - a.original.length);

  replacements.forEach((item) => {
    const pattern = new RegExp(`@${escapeRegex(item.original)}(?=\\b|$)`, "gi");
    safe = safe.replace(
      pattern,
      `<span class="mention">@${item.currentLabel}</span>`
    );
  });

  return safe;
}

function bindAutoResize(textarea) {
  if (!textarea) {
    return;
  }

  const resize = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  };

  textarea.addEventListener("input", resize);
  resize();
}

function createMentionAutocomplete(inputEl, members = []) {
  if (!inputEl) {
    return { setMembers: () => {} };
  }

  const container = inputEl.parentElement;
  const menu = document.createElement("div");
  menu.className = "mention-menu";
  menu.hidden = true;
  menu.innerHTML = "<ul></ul>";
  container?.appendChild(menu);

  let activeIndex = 0;
  let matches = [];
  let lastAtIndex = -1;

  const setMembers = (nextMembers = []) => {
    members = nextMembers;
  };

  const hideMenu = () => {
    menu.hidden = true;
    matches = [];
    activeIndex = 0;
    lastAtIndex = -1;
  };

  const renderMenu = () => {
    const list = menu.querySelector("ul");
    if (!list) {
      return;
    }

    if (!matches.length) {
      hideMenu();
      return;
    }

    list.innerHTML = matches
      .map((member, index) => {
        const label = buildMemberLabel(member);
        const isActive = index === activeIndex;
        return `
          <li>
            <button
              type="button"
              class="mention-option${isActive ? " is-active" : ""}"
              data-mention-index="${index}"
            >
              ${escapeHtml(label)}
            </button>
          </li>
        `;
      })
      .join("");

    menu.hidden = false;
  };

  const updateMatches = () => {
    const cursor = inputEl.selectionStart || 0;
    const prefix = inputEl.value.slice(0, cursor);
    const atIndex = prefix.lastIndexOf("@");
    if (atIndex === -1) {
      hideMenu();
      return;
    }

    const before = atIndex === 0 ? "" : prefix[atIndex - 1];
    if (before && !/\s/.test(before)) {
      hideMenu();
      return;
    }

    const query = prefix.slice(atIndex + 1);
    if (query.includes("\n")) {
      hideMenu();
      return;
    }

    const normalized = query.toLowerCase();
    matches = members
      .map((member) => ({ member, label: buildMemberLabel(member) }))
      .filter((entry) => entry.label && entry.label.toLowerCase().startsWith(normalized))
      .map((entry) => entry.member)
      .slice(0, 6);

    activeIndex = 0;
    lastAtIndex = atIndex;
    renderMenu();
  };

  const applySelection = (member) => {
    if (!member || lastAtIndex < 0) {
      return;
    }

    const label = buildMemberLabel(member);
    const cursor = inputEl.selectionStart || 0;
    const before = inputEl.value.slice(0, lastAtIndex);
    const after = inputEl.value.slice(cursor);
    const insert = `@${label} `;
    inputEl.value = `${before}${insert}${after}`;
    const nextCursor = before.length + insert.length;
    inputEl.setSelectionRange(nextCursor, nextCursor);
    inputEl.focus();
    hideMenu();
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  };

  inputEl.addEventListener("input", updateMatches);
  inputEl.addEventListener("click", updateMatches);
  inputEl.addEventListener("keydown", (event) => {
    if (menu.hidden || !matches.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % matches.length;
      renderMenu();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + matches.length) % matches.length;
      renderMenu();
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applySelection(matches[activeIndex]);
    }

    if (event.key === "Escape") {
      hideMenu();
    }
  });

  menu.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const button = event.target.closest("[data-mention-index]");
    if (!button) {
      return;
    }

    const index = Number(button.dataset.mentionIndex);
    const member = matches[index];
    if (member) {
      applySelection(member);
    }
  });

  inputEl.addEventListener("blur", () => {
    setTimeout(() => hideMenu(), 100);
  });

  return { setMembers };
}

const COMMENT_SELECT =
  "id, content, project_id, task_id, author_id, created_at, updated_at, app_users (display_name, email), comment_reactions (reaction, user_id), comment_mentions (mentioned_user_id, mention_text, app_users (display_name, email))";

function normalizeComment(row) {
  const authorName = resolveDisplayName(row.app_users);
  return {
    ...row,
    authorName,
    authorInitials: getInitials(authorName),
    reactions: row.comment_reactions || [],
    mentions: row.comment_mentions || []
  };
}

function renderCommentItem(comment, currentUserId, canModerate) {
  const canEdit = comment.author_id === currentUserId;
  const canDelete = canEdit || canModerate;
  const updated = comment.updated_at && comment.updated_at !== comment.created_at;
  const timeLabel = `${formatDateTime(comment.created_at)}${updated ? " (edited)" : ""}`;
  const reactions = comment.reactions || [];
  const reactionCounts = REACTION_OPTIONS.reduce((acc, option) => {
    acc[option] = 0;
    return acc;
  }, {});
  const userReactions = new Set();
  reactions.forEach((reaction) => {
    if (reactionCounts[reaction.reaction] !== undefined) {
      reactionCounts[reaction.reaction] += 1;
    }
    if (reaction.user_id === currentUserId) {
      userReactions.add(reaction.reaction);
    }
  });

  return `
    <li class="comment-item" data-comment-id="${comment.id}">
      <div class="comment-meta">
        <div class="comment-author">
          <span class="comment-avatar" aria-hidden="true">${comment.authorInitials}</span>
          <span>${escapeHtml(comment.authorName)}</span>
        </div>
        <span class="comment-time">${escapeHtml(timeLabel)}</span>
      </div>
      <div class="comment-body">${renderCommentContent(comment.content, comment.mentions)}</div>
      <div class="comment-reactions" role="group" aria-label="Reactions">
        ${REACTION_OPTIONS.map((option) => {
          const count = reactionCounts[option];
          const isActive = userReactions.has(option);
          return `
            <button
              class="reaction-btn${isActive ? " is-active" : ""}"
              type="button"
              data-comment-id="${comment.id}"
              data-reaction="${option}"
            >
              <span aria-hidden="true">${option}</span>
              ${count ? `<span class="reaction-count">${count}</span>` : ""}
            </button>
          `;
        }).join("")}
      </div>
      ${
        canEdit || canDelete
          ? `
        <div class="comment-actions">
          ${
            canEdit
              ? `<button class="comment-action-btn" type="button" data-comment-edit data-comment-id="${comment.id}">Edit</button>`
              : ""
          }
          ${
            canDelete
              ? `<button class="comment-action-btn is-danger" type="button" data-comment-delete data-comment-id="${comment.id}">Delete</button>`
              : ""
          }
        </div>`
          : ""
      }
    </li>
  `;
}

function createCommentManager({
  listEl,
  formEl,
  inputEl,
  messageEl,
  submitButton,
  cancelButton,
  countEl,
  currentUserId,
  canModerate,
  targetType
}) {
  let targetId = null;
  let editingId = null;
  let members = [];
  const comments = new Map();
  const mentionAutocomplete = createMentionAutocomplete(inputEl, members);

  const setMessage = (text, isError = false) => {
    if (!messageEl) {
      return;
    }

    messageEl.textContent = text || "";
    if (isError) {
      messageEl.classList.add("is-error");
    } else {
      messageEl.classList.remove("is-error");
    }
  };

  const setSubmitState = (loading) => {
    if (!submitButton) {
      return;
    }

    submitButton.disabled = loading;
    if (loading) {
      submitButton.textContent = "Saving...";
      return;
    }

    submitButton.textContent = editingId ? "Update" : "Post";
  };

  const renderList = () => {
    if (!listEl) {
      return;
    }

    const ordered = [...comments.values()].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    listEl.innerHTML = ordered.length
      ? ordered.map((comment) => renderCommentItem(comment, currentUserId, canModerate)).join("")
      : '<li class="comment-empty">No comments yet.</li>';

    if (countEl) {
      countEl.textContent = String(ordered.length);
    }
  };

  const resetForm = () => {
    editingId = null;
    if (inputEl) {
      inputEl.value = "";
      inputEl.style.height = "";
    }
    if (cancelButton) {
      cancelButton.hidden = true;
    }
    setMessage("");
    setSubmitState(false);
  };

  const setEditing = (comment) => {
    editingId = comment.id;
    if (inputEl) {
      inputEl.value = comment.content || "";
      inputEl.focus();
    }
    if (cancelButton) {
      cancelButton.hidden = false;
    }
    setSubmitState(false);
  };

  const setTargetId = (id) => {
    targetId = id;
    resetForm();
  };

  const setMembers = (nextMembers = []) => {
    members = nextMembers;
    mentionAutocomplete.setMembers(nextMembers);
  };

  const setComments = (rows = []) => {
    comments.clear();
    rows.forEach((row) => {
      comments.set(row.id, normalizeComment(row));
    });
    renderList();
  };

  const upsertComment = (row) => {
    comments.set(row.id, normalizeComment(row));
    renderList();
  };

  const removeComment = (id) => {
    comments.delete(id);
    if (editingId === id) {
      resetForm();
    }
    renderList();
  };

  const persistMentions = async (commentId, mentions) => {
    const { error: deleteError } = await supabase
      .from("comment_mentions")
      .delete()
      .eq("comment_id", commentId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    if (!mentions.length) {
      return;
    }

    const rows = mentions.map((mention) => ({
      comment_id: commentId,
      mentioned_user_id: mention.mentioned_user_id,
      mention_text: mention.mention_text
    }));

    const { error: insertError } = await supabase.from("comment_mentions").insert(rows);
    if (insertError) {
      throw new Error(insertError.message);
    }
  };

  const submitComment = async (event) => {
    if (event) {
      event.preventDefault();
    }

    if (!targetId) {
      setMessage("Missing comment target.", true);
      return;
    }

    const content = String(inputEl?.value || "").trim();
    if (!content) {
      setMessage("Comment cannot be empty.", true);
      return;
    }

    setMessage("");
    setSubmitState(true);

    const payload = {
      content,
      author_id: currentUserId,
      project_id: targetType === "project" ? targetId : null,
      task_id: targetType === "task" ? targetId : null
    };
    const mentions = extractMentions(content, members);

    try {
      if (editingId) {
        const { error } = await supabase
          .from("comments")
          .update({ content })
          .eq("id", editingId);

        if (error) {
          throw new Error(error.message);
        }

        await persistMentions(editingId, mentions);
        const refreshed = await fetchCommentById(editingId);
        upsertComment(refreshed);
      } else {
        const { data, error } = await supabase
          .from("comments")
          .insert(payload)
          .select("id")
          .single();
        if (error) {
          throw new Error(error.message);
        }

        if (data?.id) {
          await persistMentions(data.id, mentions);
          const refreshed = await fetchCommentById(data.id);
          upsertComment(refreshed);
        }
      }

      resetForm();
    } catch (error) {
      setMessage(error.message, true);
      setSubmitState(false);
    }
  };

  const handleListClick = async (event) => {
    const reactionButton = event.target.closest("[data-reaction]");
    if (reactionButton) {
      const commentId = reactionButton.dataset.commentId;
      const reaction = reactionButton.dataset.reaction;
      const comment = comments.get(commentId);
      if (!comment || !reaction) {
        return;
      }

      const prevReactions = comment.reactions || [];
      const hasReacted = prevReactions.some(
        (entry) => entry.user_id === currentUserId && entry.reaction === reaction
      );

      const nextReactions = hasReacted
        ? prevReactions.filter(
            (r) => !(r.user_id === currentUserId && r.reaction === reaction)
          )
        : [...prevReactions, { user_id: currentUserId, reaction }];

      comments.set(commentId, { ...comment, reactions: nextReactions });
      renderList();

      try {
        if (hasReacted) {
          const { error } = await supabase
            .from("comment_reactions")
            .delete()
            .eq("comment_id", commentId)
            .eq("user_id", currentUserId)
            .eq("reaction", reaction);

          if (error) {
            throw new Error(error.message);
          }
        } else {
          const { error } = await supabase.from("comment_reactions").insert({
            comment_id: commentId,
            user_id: currentUserId,
            reaction
          });

          if (error) {
            throw new Error(error.message);
          }
        }
      } catch (error) {
        comments.set(commentId, comment);
        renderList();
        setMessage(error.message, true);
      }

      return;
    }

    const editButton = event.target.closest("[data-comment-edit]");
    if (editButton) {
      const commentId = editButton.dataset.commentId;
      const comment = comments.get(commentId);
      if (comment) {
        setEditing(comment);
      }
      return;
    }

    const deleteButton = event.target.closest("[data-comment-delete]");
    if (!deleteButton) {
      return;
    }

    const commentId = deleteButton.dataset.commentId;
    const comment = comments.get(commentId);
    if (!comment) {
      return;
    }

    const confirmDelete = window.confirm("Delete this comment?");
    if (!confirmDelete) {
      return;
    }

    try {
      const { error } = await supabase.from("comments").delete().eq("id", commentId);
      if (error) {
        throw new Error(error.message);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  };

  if (formEl) {
    formEl.addEventListener("submit", submitComment);
  }

  if (submitButton && !formEl) {
    submitButton.addEventListener("click", submitComment);
  }

  if (cancelButton) {
    cancelButton.addEventListener("click", () => resetForm());
  }

  if (listEl) {
    listEl.addEventListener("click", handleListClick);
  }

  bindAutoResize(inputEl);

  return {
    setTargetId,
    setMembers,
    setComments,
    upsertComment,
    removeComment,
    resetForm,
    setMessage,
    hasComment: (id) => comments.has(id)
  };
}

async function fetchCommentsByProject(projectId) {
  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function fetchCommentsByTask(taskId) {
  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function fetchCommentById(commentId) {
  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("id", commentId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function fetchChecklistItems(taskId) {
  const { data, error } = await supabase
    .from("task_checklist_items")
    .select("id, task_id, text, checked, position, created_at")
    .eq("task_id", taskId)
    .order("position", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

function subscribeToComments({ targetType, targetId, manager }) {
  if (!targetId) {
    return null;
  }

  const filterKey = targetType === "project" ? "project_id" : "task_id";
  const channel = supabase
    .channel(`comments:${targetType}:${targetId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "comments",
        filter: `${filterKey}=eq.${targetId}`
      },
      async (payload) => {
        if (payload.eventType === "DELETE") {
          manager.removeComment(payload.old.id);
          return;
        }

        try {
          const comment = await fetchCommentById(payload.new.id);
          manager.upsertComment(comment);
        } catch (error) {
          manager.setMessage(error.message, true);
        }
      }
    )
    .subscribe();

  return channel;
}

function subscribeToCommentReactions(manager) {
  const channel = supabase
    .channel(`comment-reactions:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "comment_reactions"
      },
      async (payload) => {
        const commentId = payload.new?.comment_id || payload.old?.comment_id;
        if (!commentId || !manager.hasComment(commentId)) {
          return;
        }

        try {
          const comment = await fetchCommentById(commentId);
          manager.upsertComment(comment);
        } catch (error) {
          manager.setMessage(error.message, true);
        }
      }
    )
    .subscribe();

  return channel;
}

function createChecklistManager({ listEl, inputEl, addBtnEl, progressEl, barFillEl }) {
  let taskId = null;
  const items = new Map();

  const updateProgress = () => {
    const all = [...items.values()];
    const total = all.length;
    const checked = all.filter((i) => i.checked).length;
    if (progressEl) progressEl.textContent = `${checked} / ${total}`;
    if (barFillEl) barFillEl.style.width = total > 0 ? `${Math.round((checked / total) * 100)}%` : "0%";
  };

  const renderList = () => {
    if (!listEl) return;
    const ordered = [...items.values()].sort((a, b) => a.position - b.position);
    listEl.innerHTML = ordered.length
      ? ordered
          .map(
            (item) => `
          <li class="checklist-item" data-item-id="${item.id}">
            <input
              type="checkbox"
              ${item.checked ? "checked" : ""}
              data-checklist-toggle
              data-item-id="${item.id}"
              aria-label="${escapeHtml(item.text)}"
            />
            <span class="checklist-item-text${item.checked ? " is-checked" : ""}">${escapeHtml(item.text)}</span>
            <button type="button" class="checklist-item-delete" data-checklist-delete data-item-id="${item.id}" aria-label="Delete item">&times;</button>
          </li>
        `
          )
          .join("")
      : '<li class="checklist-empty">No items yet. Add one below.</li>';
    updateProgress();
  };

  const setItems = (rows = []) => {
    items.clear();
    rows.forEach((row) => items.set(row.id, row));
    renderList();
  };

  const setTaskId = (id) => {
    taskId = id;
    setItems([]);
  };

  const getChecklistCounts = () => {
    const all = [...items.values()];
    return { total: all.length, checked: all.filter((i) => i.checked).length };
  };

  const handleToggle = async (itemId) => {
    const item = items.get(itemId);
    if (!item) return;
    const nextChecked = !item.checked;
    items.set(itemId, { ...item, checked: nextChecked });
    renderList();
    const { error } = await supabase
      .from("task_checklist_items")
      .update({ checked: nextChecked })
      .eq("id", itemId);
    if (error) {
      items.set(itemId, item);
      renderList();
    }
  };

  const handleDelete = async (itemId) => {
    const item = items.get(itemId);
    if (!item) return;
    items.delete(itemId);
    renderList();
    const { error } = await supabase
      .from("task_checklist_items")
      .delete()
      .eq("id", itemId);
    if (error) {
      items.set(itemId, item);
      renderList();
    }
  };

  const handleAdd = async () => {
    if (!inputEl) return;
    const text = String(inputEl.value || "").trim();
    if (!text || !taskId) return;
    inputEl.disabled = true;
    if (addBtnEl) addBtnEl.disabled = true;
    const position = items.size;
    try {
      const { data, error } = await supabase
        .from("task_checklist_items")
        .insert({ task_id: taskId, text, position })
        .select("id, task_id, text, checked, position, created_at")
        .single();
      if (error) throw new Error(error.message);
      items.set(data.id, data);
      inputEl.value = "";
      renderList();
    } catch (_) {
      // silent — user can retry
    }
    inputEl.disabled = false;
    if (addBtnEl) addBtnEl.disabled = false;
    inputEl.focus();
  };

  if (listEl) {
    listEl.addEventListener("click", (event) => {
      const toggleEl = event.target.closest("[data-checklist-toggle]");
      if (toggleEl) {
        handleToggle(toggleEl.dataset.itemId);
        return;
      }
      const deleteEl = event.target.closest("[data-checklist-delete]");
      if (deleteEl) {
        handleDelete(deleteEl.dataset.itemId);
      }
    });
  }

  if (addBtnEl) {
    addBtnEl.addEventListener("click", handleAdd);
  }

  if (inputEl) {
    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleAdd();
      }
    });
  }

  return { setTaskId, setItems, getChecklistCounts };
}

function updateTaskCardChecklistBadge(card, counts) {
  if (!card) return;
  const existing = card.querySelector("[data-checklist-badge]");
  if (!counts || counts.total === 0) {
    if (existing) existing.remove();
    return;
  }
  const isComplete = counts.checked === counts.total;
  const className = `checklist-badge${isComplete ? " is-complete" : ""}`;
  const content = `☑ ${counts.checked}/${counts.total}`;
  if (existing) {
    existing.className = className;
    existing.textContent = content;
  } else {
    const meta = card.querySelector(".task-meta");
    if (meta) {
      meta.insertAdjacentHTML(
        "beforeend",
        `<span class="${className}" data-checklist-badge>${content}</span>`
      );
    }
  }
}

async function fetchTaskTimerState(taskId) {
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, total_tracked_seconds, timer_running, timer_started_at")
    .eq("id", taskId)
    .single();
  if (error) throw new Error(error.message);

  let openEntryId = null;
  if (task.timer_running) {
    const { data: entry } = await supabase
      .from("task_time_entries")
      .select("id")
      .eq("task_id", taskId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();
    if (entry) openEntryId = entry.id;
  }

  return { ...task, openEntryId };
}

function createTimerManager({ displayEl, toggleEl, messageEl, currentUserId }) {
  let taskId = null;
  let totalSeconds = 0;
  let timerRunning = false;
  let timerStartedAt = null;
  let openEntryId = null;
  let intervalId = null;

  const setMessage = (text, isError = false) => {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.classList.toggle("is-error", isError);
  };

  const updateDisplay = () => {
    if (!displayEl) return;
    const extra =
      timerRunning && timerStartedAt
        ? Math.floor((Date.now() - new Date(timerStartedAt).getTime()) / 1000)
        : 0;
    displayEl.textContent = formatSeconds(totalSeconds + extra);
  };

  const updateToggle = () => {
    if (!toggleEl) return;
    toggleEl.textContent = timerRunning ? "Stop timer" : "Start timer";
    toggleEl.classList.toggle("is-running", timerRunning);
  };

  const stopInterval = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const startInterval = () => {
    stopInterval();
    intervalId = setInterval(updateDisplay, 1000);
  };

  const init = (state) => {
    taskId = state.id;
    totalSeconds = state.total_tracked_seconds || 0;
    timerRunning = state.timer_running || false;
    timerStartedAt = state.timer_started_at || null;
    openEntryId = state.openEntryId || null;
    setMessage("");
    updateDisplay();
    updateToggle();
    if (timerRunning) {
      startInterval();
    } else {
      stopInterval();
    }
  };

  const cleanup = () => {
    stopInterval();
    taskId = null;
    openEntryId = null;
  };

  const handleToggle = async () => {
    if (!taskId || !toggleEl) return;
    toggleEl.disabled = true;

    if (timerRunning) {
      const now = new Date();
      const elapsed =
        timerStartedAt
          ? Math.max(0, Math.floor((now.getTime() - new Date(timerStartedAt).getTime()) / 1000))
          : 0;
      const newTotal = totalSeconds + elapsed;

      try {
        const { error: taskError } = await supabase
          .from("tasks")
          .update({ total_tracked_seconds: newTotal, timer_running: false, timer_started_at: null })
          .eq("id", taskId);
        if (taskError) throw new Error(taskError.message);

        if (openEntryId) {
          const { error: entryError } = await supabase
            .from("task_time_entries")
            .update({ ended_at: now.toISOString(), duration_seconds: elapsed })
            .eq("id", openEntryId);
          if (entryError) throw new Error(entryError.message);
        }

        totalSeconds = newTotal;
        timerRunning = false;
        timerStartedAt = null;
        openEntryId = null;
        stopInterval();
        updateDisplay();
        updateToggle();
      } catch (err) {
        setMessage(err.message, true);
      }
    } else {
      const now = new Date();
      try {
        const { data: entry, error: entryError } = await supabase
          .from("task_time_entries")
          .insert({ task_id: taskId, user_id: currentUserId, started_at: now.toISOString() })
          .select("id")
          .single();
        if (entryError) throw new Error(entryError.message);

        const { error: taskError } = await supabase
          .from("tasks")
          .update({ timer_running: true, timer_started_at: now.toISOString() })
          .eq("id", taskId);
        if (taskError) throw new Error(taskError.message);

        openEntryId = entry?.id || null;
        timerRunning = true;
        timerStartedAt = now.toISOString();
        updateToggle();
        startInterval();
      } catch (err) {
        setMessage(err.message, true);
      }
    }

    toggleEl.disabled = false;
  };

  if (toggleEl) {
    toggleEl.addEventListener("click", handleToggle);
  }

  return { init, cleanup };
}

function isDoneStage(name) {
  return String(name || "").toLowerCase().includes("done");
}

function resolveStageStatus(name) {
  const normalized = String(name || "").toLowerCase();

  if (normalized.includes("done")) {
    return "done";
  }

  if (normalized.includes("in progress")) {
    return "in_progress";
  }

  return "todo";
}

function findStageIdByStatus(stageMeta, desiredStatus) {
  for (const [stageId, info] of stageMeta.entries()) {
    if (resolveStageStatus(info?.name) === desiredStatus) {
      return stageId;
    }
  }

  return null;
}

function findFirstStageIdByDone(stageMeta, doneFlag) {
  for (const [stageId, info] of stageMeta.entries()) {
    if (Boolean(info?.done) === doneFlag) {
      return stageId;
    }
  }

  return null;
}

function formatStageLabel(name, doneFlag) {
  const normalized = String(name || "").toLowerCase();

  if (doneFlag || normalized.includes("done")) {
    return "Done";
  }

  if (normalized.includes("in progress")) {
    return "In Progress";
  }

  if (normalized.includes("not started")) {
    return "Not Started";
  }

  if (!name) {
    return "Active";
  }

  return String(name).replace(/\b\w/g, (char) => char.toUpperCase());
}

const ATTACHMENTS_BUCKET = "task-attachments";
const ATTACHMENT_PREVIEW_TTL_SECONDS = 60 * 60;

function sanitizeFileName(name) {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+/, "")
    .slice(0, 120);
}

function isImageAttachment(mimeType, fileName) {
  if (mimeType && mimeType.startsWith("image/")) {
    return true;
  }

  const extension = String(fileName || "").toLowerCase().split(".").pop();
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(extension);
}

async function fetchTaskAttachments(taskId) {
  const { data, error } = await supabase
    .from("task_attachments")
    .select("id, task_id, file_name, file_path, mime_type, size, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  return data || [];
}

async function addAttachmentPreviewUrls(attachments) {
  const enriched = await Promise.all(
    attachments.map(async (attachment) => {
      const isImage = isImageAttachment(attachment.mime_type, attachment.file_name);
      const { data, error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(attachment.file_path, ATTACHMENT_PREVIEW_TTL_SECONDS);

      if (error) {
        return { ...attachment, isImage, previewUrl: "", downloadUrl: "" };
      }

      return {
        ...attachment,
        isImage,
        previewUrl: isImage ? data?.signedUrl || "" : "",
        downloadUrl: data?.signedUrl || ""
      };
    })
  );

  return enriched;
}

async function fetchTaskCoverUrls(taskIds) {
  if (!taskIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("task_attachments")
    .select("task_id, file_path, file_name, mime_type, created_at")
    .in("task_id", taskIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const firstImageByTask = new Map();
  (data || []).forEach((attachment) => {
    if (firstImageByTask.has(attachment.task_id)) {
      return;
    }

    if (isImageAttachment(attachment.mime_type, attachment.file_name)) {
      firstImageByTask.set(attachment.task_id, attachment);
    }
  });

  const coverMap = new Map();
  for (const [taskId, attachment] of firstImageByTask.entries()) {
    const { data: signed, error: signedError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(attachment.file_path, ATTACHMENT_PREVIEW_TTL_SECONDS);

    if (!signedError && signed?.signedUrl) {
      coverMap.set(taskId, signed.signedUrl);
    }
  }

  return coverMap;
}

async function fetchTaskCoverUrl(taskId) {
  const coverMap = await fetchTaskCoverUrls([taskId]);
  return coverMap.get(taskId) || "";
}

function updateTaskCardCover(card, coverUrl, title) {
  if (!card) {
    return;
  }

  const existing = card.querySelector(".task-cover");
  if (!coverUrl) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  const safeCoverUrl = escapeHtml(coverUrl);
  const safeTitle = escapeHtml(title || "Task");
  if (existing) {
    existing.src = coverUrl;
    existing.alt = `${safeTitle} cover`;
    return;
  }

  card.insertAdjacentHTML(
    "afterbegin",
    `<img class="task-cover" src="${safeCoverUrl}" alt="${safeTitle} cover" />`
  );
}

async function refreshAttachmentEditor(taskId, editor) {
  if (!editor) {
    return [];
  }

  const attachments = await fetchTaskAttachments(taskId);
  const enriched = await addAttachmentPreviewUrls(attachments);
  editor.setExistingAttachments(enriched);
  return enriched;
}

async function persistAttachmentChanges(taskId, editor, userId) {
  if (!editor) {
    return [];
  }

  const { uploads, deletions } = editor.getPendingChanges();
  const deletionIds = deletions.map((attachment) => attachment.id);
  const deletionPaths = deletions.map((attachment) => attachment.file_path);

  if (!uploads.length && !deletionPaths.length) {
    editor.reset();
    return [];
  }

  if (deletionPaths.length) {
    const { error: storageDeleteError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove(deletionPaths);

    if (storageDeleteError) {
      throw new Error(storageDeleteError.message);
    }

    const { error: deleteError } = await supabase
      .from("task_attachments")
      .delete()
      .in("id", deletionIds);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  if (uploads.length) {
    const rows = [];
    const uploadedPaths = [];

    for (const upload of uploads) {
      const safeName = sanitizeFileName(upload.file.name || "attachment");
      const filePath = `${taskId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(filePath, upload.file, {
          contentType: upload.file.type || "application/octet-stream",
          upsert: false
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      uploadedPaths.push(filePath);

      rows.push({
        task_id: taskId,
        file_name: upload.file.name,
        file_path: filePath,
        mime_type: upload.file.type || null,
        size: upload.file.size || null,
        created_by_user_id: userId
      });
    }

    if (rows.length) {
      const { error: insertError } = await supabase.from("task_attachments").insert(rows);
      if (insertError) {
        if (uploadedPaths.length) {
          await supabase.storage.from(ATTACHMENTS_BUCKET).remove(uploadedPaths);
        }
        throw new Error(insertError.message);
      }
    }
  }

  return refreshAttachmentEditor(taskId, editor);
}

function renderTaskCard(task, stageId, stageName, doneFlag, coverUrl, checklistCounts = null) {
  const description = stripHtml(task.description_html || "");
  const statusClass = doneFlag ? "task-status is-done" : "task-status";
  const statusLabel = formatStageLabel(stageName, doneFlag);
  const safeTitle = escapeHtml(task.title || "Untitled task");
  const coverMarkup = coverUrl
    ? `<img class="task-cover" src="${escapeHtml(coverUrl)}" alt="${safeTitle} cover" />`
    : "";
  const safeDescription = description
    ? `<p class="task-description">${escapeHtml(description)}</p>`
    : '<p class="task-description">No description yet.</p>';
  const position = Number.isFinite(task.position) ? task.position : 0;
  const priority = escapeHtml(task.priority || "medium");
  const timerRunning = Boolean(task.timer_running);
  const timerStartedAt = task.timer_started_at || null;
  const totalSeconds = task.total_tracked_seconds || 0;
  const liveSeconds =
    timerRunning && timerStartedAt
      ? Math.floor((Date.now() - new Date(timerStartedAt).getTime()) / 1000)
      : 0;

  const checklistBadge =
    checklistCounts && checklistCounts.total > 0
      ? `<span class="checklist-badge${checklistCounts.checked === checklistCounts.total ? " is-complete" : ""}" data-checklist-badge>☑ ${checklistCounts.checked}/${checklistCounts.total}</span>`
      : "";

  const deadlineInfo = resolveDeadlineState(task.deadline);
  const deadlineBadge = deadlineInfo
    ? `<span class="deadline-badge is-${deadlineInfo.state}" data-deadline-badge>📅 ${deadlineInfo.label}</span>`
    : "";

  return `
    <li class="task-card" draggable="true" data-task-id="${task.id}" data-stage-id="${stageId}" data-position="${position}">
      ${coverMarkup}
      <h3 class="task-title" data-task-title>${safeTitle}</h3>
      ${safeDescription}
      <div class="task-meta">
        <span class="${statusClass}">${statusLabel}</span>
        <span class="priority-badge priority-${priority}">${priority}</span>
        ${checklistBadge}
      </div>
      <div class="task-meta">
        <span class="task-meta-text">Created ${formatDate(task.created_at)}</span>
        ${deadlineBadge}
      </div>
      <div class="task-timer">
        <span class="task-timer-display" data-timer-display>${formatSeconds(totalSeconds + liveSeconds)}</span>
        <button
          type="button"
          class="task-timer-btn${timerRunning ? " is-running" : ""}"
          data-timer-toggle
          data-task-id="${task.id}"
        >${timerRunning ? "Stop" : "Start"}</button>
      </div>
      <div class="task-actions">
        <button
          type="button"
          class="task-action-btn"
          data-task-edit
          data-task-id="${task.id}"
          data-task-title="${safeTitle}"
          data-task-description="${escapeHtml(description)}"
          data-task-priority="${priority}"
          data-task-done="${task.done ? "true" : "false"}"
          data-task-status="${escapeHtml(task.status || "")}"
          data-task-deadline="${escapeHtml(task.deadline || "")}"
        >
          Edit
        </button>
        <button
          type="button"
          class="task-action-btn"
          data-task-open-checklist
          data-task-id="${task.id}"
          data-task-title="${safeTitle}"
        >
          Checklist
        </button>
        <button
          type="button"
          class="task-action-btn is-danger"
          data-task-delete
          data-task-id="${task.id}"
        >
          Delete
        </button>
      </div>
    </li>
  `;
}

function getProjectIdFromPath(pathname) {
  const match = pathname.match(/^\/project\/([^/]+)\/taskboard\/?$/);

  if (!match) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

function getDragAfterElement(container, y) {
  const draggableElements = [
    ...container.querySelectorAll(".task-card:not(.is-dragging)")
  ];

  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }

      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function updateColumnCounts() {
  document.querySelectorAll(".taskboard-column").forEach((column) => {
    const badge = column.querySelector(".stage-badge");
    if (!badge) {
      return;
    }

    const count = column.querySelectorAll(".task-card").length;
    badge.textContent = count;
  });
}

function ensureEmptyState(list) {
  const hasCards = list.querySelector(".task-card");
  const empty = list.querySelector(".task-empty");

  if (hasCards && empty) {
    empty.remove();
  }

  if (!hasCards && !empty) {
    list.insertAdjacentHTML("beforeend", '<li class="task-empty">No tasks in this stage.</li>');
  }
}

function updateTaskStatus(card, stageName, doneFlag) {
  const status = card.querySelector(".task-status");
  if (!status) {
    return;
  }

  if (doneFlag) {
    status.classList.add("is-done");
    status.textContent = formatStageLabel(stageName, doneFlag);
  } else {
    status.classList.remove("is-done");
    status.textContent = formatStageLabel(stageName, doneFlag);
  }

  const editBtn = card.querySelector("[data-task-edit]");
  if (editBtn) {
    editBtn.dataset.taskDone = doneFlag ? "true" : "false";
    editBtn.dataset.taskStatus = resolveStageStatus(stageName);
  }
}

function wireTaskCard(card) {
  card.addEventListener("dragstart", () => {
    dragState.sourceStageId = card.dataset.stageId || null;
    card.classList.add("is-dragging");
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("is-dragging");
    document.querySelectorAll(".taskboard-column").forEach((column) => {
      column.classList.remove("is-drop-target");
    });
    updateColumnCounts();
  });
}

async function persistListOrder(list, stageId, doneFlag, statusValue) {
  const cards = [...list.querySelectorAll(".task-card")];
  if (!cards.length) {
    return;
  }

  const taskIds = cards.map((card) => card.dataset.taskId).filter(Boolean);

  const { error } = await supabase.rpc("reorder_tasks", {
    p_stage_id: stageId,
    p_task_ids: taskIds,
    p_done: doneFlag,
    p_status: statusValue
  });

  if (error) {
    throw new Error(error.message);
  }

  cards.forEach((card, index) => {
    card.dataset.position = String(index);
  });
}

function setupTaskDragAndDrop(stageMeta, messageEl) {
  const lists = document.querySelectorAll(".task-list");
  const columns = document.querySelectorAll(".taskboard-column");

  document.querySelectorAll(".task-card").forEach((card) => {
    wireTaskCard(card);
  });

  lists.forEach((list) => {
    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      const draggingCard = document.querySelector(".task-card.is-dragging");
      if (!draggingCard) {
        return;
      }

      const afterElement = getDragAfterElement(list, event.clientY);
      if (afterElement) {
        list.insertBefore(draggingCard, afterElement);
      } else {
        list.appendChild(draggingCard);
      }
    });
  });

  columns.forEach((column) => {
    column.addEventListener("dragover", (event) => {
      event.preventDefault();
      column.classList.add("is-drop-target");
      const list = column.querySelector(".task-list");
      if (!list) {
        return;
      }

      const draggingCard = document.querySelector(".task-card.is-dragging");
      if (!draggingCard) {
        return;
      }

      const afterElement = getDragAfterElement(list, event.clientY);
      if (afterElement) {
        list.insertBefore(draggingCard, afterElement);
      } else {
        list.appendChild(draggingCard);
      }
    });

    column.addEventListener("dragleave", () => {
      column.classList.remove("is-drop-target");
    });

    column.addEventListener("drop", async () => {
      const list = column.querySelector(".task-list");
      const draggingCard = document.querySelector(".task-card.is-dragging");
      if (!list || !draggingCard) {
        return;
      }

      const stageId = column.dataset.stageId || "";
      const stageInfo = stageMeta.get(stageId);
      const doneFlag = Boolean(stageInfo?.done);
      const statusValue = resolveStageStatus(stageInfo?.name);
      const sourceStageId = dragState.sourceStageId;

      draggingCard.dataset.stageId = stageId;
      list.querySelectorAll(".task-card").forEach((card) => {
        card.dataset.stageId = stageId;
        updateTaskStatus(card, stageInfo?.name, doneFlag);
      });
      column.classList.remove("is-drop-target");

      ensureEmptyState(list);
      if (sourceStageId && sourceStageId !== stageId) {
        const sourceColumn = document.querySelector(
          `.taskboard-column[data-stage-id="${sourceStageId}"]`
        );
        const sourceList = sourceColumn?.querySelector(".task-list");
        if (sourceList) {
          const sourceInfo = stageMeta.get(sourceStageId);
          const sourceDone = Boolean(sourceInfo?.done);
          sourceList.querySelectorAll(".task-card").forEach((card) => {
            card.dataset.stageId = sourceStageId;
            updateTaskStatus(card, sourceInfo?.name, sourceDone);
          });
          ensureEmptyState(sourceList);
        }
      }

      updateColumnCounts();

      messageEl.textContent = "";
      messageEl.classList.remove("is-error");
      try {
        if (sourceStageId && sourceStageId !== stageId) {
          const sourceInfo = stageMeta.get(sourceStageId);
          const sourceList = document.querySelector(
            `.taskboard-column[data-stage-id="${sourceStageId}"] .task-list`
          );
          if (sourceList) {
            const sourceStatus = resolveStageStatus(sourceInfo?.name);
            await persistListOrder(
              sourceList,
              sourceStageId,
              Boolean(sourceInfo?.done),
              sourceStatus
            );
          }
        }

        await persistListOrder(list, stageId, doneFlag, statusValue);
      } catch (error) {
        messageEl.textContent = error.message;
        messageEl.classList.add("is-error");
      }
    });
  });
}

function updateDeadlineHint(dateValue, hintEl) {
  if (!hintEl) return;
  const info = resolveDeadlineState(dateValue);
  hintEl.textContent = info ? info.label : "";
  hintEl.className = `deadline-hint${info ? ` is-${info.state}` : ""}`;
}

async function bootstrap() {
  app.innerHTML = `
    <div class="page-shell">
      <div class="skeleton-header-bar"></div>
      <main class="page-content">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap">
          <div>
            <div class="skeleton skeleton-h1"></div>
            <div class="skeleton skeleton-text"></div>
          </div>
        </div>
        <div class="taskboard-grid">
          <div class="skeleton-board-col">
            <div class="skeleton skeleton-col-head"></div>
            <div class="skeleton skeleton-board-card"></div>
            <div class="skeleton skeleton-board-card"></div>
            <div class="skeleton skeleton-board-card"></div>
          </div>
          <div class="skeleton-board-col">
            <div class="skeleton skeleton-col-head"></div>
            <div class="skeleton skeleton-board-card"></div>
            <div class="skeleton skeleton-board-card"></div>
          </div>
          <div class="skeleton-board-col">
            <div class="skeleton skeleton-col-head"></div>
            <div class="skeleton skeleton-board-card"></div>
          </div>
        </div>
      </main>
    </div>
  `;

  const session = await requireAuthenticatedSession("/login");

  if (!session) {
    return;
  }

  const userId = session.user?.id;
  if (!userId) {
    throw new Error("Could not resolve the current user.");
  }

  const params = new URLSearchParams(window.location.search);
  const projectId = getProjectIdFromPath(window.location.pathname) || params.get("id");

  if (!projectId) {
    throw new Error("Missing project id. Open this page from the Projects list.");
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, title, description, owner_user_id")
    .eq("id", projectId)
    .single();

  if (projectError) {
    throw new Error(projectError.message);
  }

  const isOwner = project.owner_user_id === userId;

  const { data: memberRows, error: memberError } = await supabase
    .from("project_members")
    .select("project_id, user_id, role")
    .eq("project_id", projectId);

  if (memberError) {
    throw new Error(memberError.message);
  }

  const memberIds = (memberRows || []).map((row) => row.user_id).filter(Boolean);
  const membersById = new Map();
  if (memberIds.length) {
    const { data: userRows, error: userError } = await supabase
      .from("app_users")
      .select("id, display_name, email")
      .in("id", memberIds);

    if (userError) {
      throw new Error(userError.message);
    }

    (userRows || []).forEach((user) => {
      membersById.set(user.id, user);
    });
  }

  const projectMembers = (memberRows || [])
    .map((member) => ({
      id: member.user_id,
      role: member.role,
      ...membersById.get(member.user_id)
    }))
    .filter((member) => member.id);

  const { data: stages, error: stageError } = await supabase
    .from("project_stages")
    .select("id, name, position, color")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (stageError) {
    throw new Error(stageError.message);
  }

  let stageList = stages ?? [];

  if (!stageList.length) {
    const defaultStages = [
      { name: "not started", position: 0 },
      { name: "in progress", position: 1 },
      { name: "done", position: 2 }
    ];

    const { data: createdStages, error: createError } = await supabase
      .from("project_stages")
      .insert(
        defaultStages.map((stage) => ({
          project_id: projectId,
          name: stage.name,
          position: stage.position
        }))
      )
      .select("id, name, position, color")
      .order("position", { ascending: true });

    if (createError) {
      throw new Error(createError.message);
    }

    stageList = createdStages ?? [];
  }

  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, description_html, position, stage_id, done, status, priority, deadline, created_at, total_tracked_seconds, timer_running, timer_started_at")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (taskError) {
    throw new Error(taskError.message);
  }

  const taskList = tasks ?? [];
  const tasksByStage = new Map();
  const stageMeta = new Map();
  const coverMap = await fetchTaskCoverUrls(taskList.map((task) => task.id));

  const checklistCountMap = new Map();
  if (taskList.length) {
    const { data: clData } = await supabase
      .from("task_checklist_items")
      .select("task_id, checked")
      .in("task_id", taskList.map((t) => t.id));
    (clData || []).forEach((row) => {
      const entry = checklistCountMap.get(row.task_id) || { total: 0, checked: 0 };
      entry.total++;
      if (row.checked) entry.checked++;
      checklistCountMap.set(row.task_id, entry);
    });
  }

  const taskTimers = new Map();
  taskList.forEach((task) => {
    taskTimers.set(task.id, {
      totalSeconds: task.total_tracked_seconds || 0,
      timerRunning: Boolean(task.timer_running),
      timerStartedAt: task.timer_started_at || null,
      intervalId: null
    });
  });

  function stopCardTimerInterval(taskId) {
    const state = taskTimers.get(taskId);
    if (!state || state.intervalId === null) return;
    clearInterval(state.intervalId);
    state.intervalId = null;
  }

  function startCardTimerInterval(taskId) {
    stopCardTimerInterval(taskId);
    const state = taskTimers.get(taskId);
    if (!state) return;
    state.intervalId = setInterval(() => {
      const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
      const displayEl = card?.querySelector("[data-timer-display]");
      if (!displayEl) return;
      const extra =
        state.timerRunning && state.timerStartedAt
          ? Math.floor((Date.now() - new Date(state.timerStartedAt).getTime()) / 1000)
          : 0;
      displayEl.textContent = formatSeconds(state.totalSeconds + extra);
    }, 1000);
  }

  function updateCardTimerUI(taskId) {
    const state = taskTimers.get(taskId);
    if (!state) return;
    const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
    if (!card) return;
    const displayEl = card.querySelector("[data-timer-display]");
    const toggleBtn = card.querySelector("[data-timer-toggle]");
    if (displayEl) {
      const extra =
        state.timerRunning && state.timerStartedAt
          ? Math.floor((Date.now() - new Date(state.timerStartedAt).getTime()) / 1000)
          : 0;
      displayEl.textContent = formatSeconds(state.totalSeconds + extra);
    }
    if (toggleBtn) {
      toggleBtn.textContent = state.timerRunning ? "Stop" : "Start";
      toggleBtn.classList.toggle("is-running", state.timerRunning);
    }
  }

  stageList.forEach((stage) => {
    tasksByStage.set(stage.id, []);
    stageMeta.set(stage.id, { name: stage.name, done: isDoneStage(stage.name) });
  });

  taskList.forEach((task) => {
    if (!tasksByStage.has(task.stage_id)) {
      tasksByStage.set(task.stage_id, []);
    }

    tasksByStage.get(task.stage_id).push(task);
  });

  const stageOptions = stageList
    .map((stage) => `<option value="${stage.id}">${escapeHtml(stage.name)}</option>`)
    .join("");

  const columns = stageList
    .map((stage) => {
      const stageTasks = tasksByStage.get(stage.id) || [];
      const doneFlag = Boolean(stageMeta.get(stage.id)?.done);
      const cards = stageTasks.length
        ? stageTasks
            .map((task) =>
              renderTaskCard(task, stage.id, stage.name, doneFlag, coverMap.get(task.id), checklistCountMap.get(task.id))
            )
            .join("")
        : '<li class="task-empty">No tasks in this stage.</li>';

      return `
        <section class="taskboard-column" data-stage-id="${stage.id}" aria-label="${escapeHtml(stage.name)}">
          <div class="taskboard-column-header">
            <h2>${escapeHtml(stage.name)}</h2>
            <span class="stage-badge">${stageTasks.length}</span>
          </div>
          <div class="taskboard-divider" aria-hidden="true"></div>
          <ul class="task-list">
            ${cards}
          </ul>
          <button class="column-add-btn" type="button" data-column-add-task="${stage.id}">+ Add task</button>
        </section>
      `;
    })
    .join("");

  app.innerHTML = `
    <div class="page-shell">
      <div data-header></div>
      <main class="page-content">
        <div class="taskboard-header">
          <div>
            <h1>${escapeHtml(project.title)} Tasks</h1>
            <p class="message">${escapeHtml(project.description || "No description yet.")}</p>
            <p class="message" data-taskboard-message role="status" aria-live="polite"></p>
          </div>
          <div class="form-actions">
            <button class="btn-primary" type="button" data-create-task>Create task</button>
            <a class="action-link" href="/project/${project.id}">Project details</a>
            <a class="action-link" href="/projects">Back to Projects</a>
          </div>
        </div>

        ${
          stageList.length
            ? `<div class="taskboard-grid" role="list">${columns}</div>`
            : '<p class="empty-state">No stages found for this project.</p>'
        }

        <section class="comment-thread" data-project-comments>
          <div class="comment-thread-header">
            <div>
              <h2>Project discussion</h2>
              <p class="message">Share updates with the team.</p>
            </div>
            <div class="comment-thread-controls">
              <span class="comment-count" data-project-comment-count>0</span>
              <button type="button" class="comment-thread-toggle" data-comment-thread-toggle>Hide</button>
            </div>
          </div>
          <div class="comment-thread-body" data-comment-thread-body>
            <ul class="comment-list" data-project-comment-list></ul>
            <form class="comment-form" data-project-comment-form>
              <label for="project-comment">Add a comment</label>
              <textarea id="project-comment" name="comment" maxlength="2000" data-project-comment-input></textarea>
              <p class="message" data-project-comment-message role="status" aria-live="polite"></p>
              <div class="comment-actions">
                <button class="btn-secondary" type="button" data-project-comment-cancel hidden>Cancel edit</button>
                <button class="btn-primary" type="submit" data-project-comment-submit>Post</button>
              </div>
            </form>
          </div>
        </section>
      </main>
      <div data-footer></div>
    </div>

    ${renderTaskEditorDialog({
      dialogAttr: "data-task-dialog",
      formAttr: "data-task-form",
      title: "Create task",
      submitLabel: "Create",
      messageAttr: "data-task-form-message",
      submitAttr: "data-submit-task",
      cancelAttr: "data-cancel-task",
      mode: "create",
      stageOptions
    })}

    ${renderTaskEditorDialog({
      dialogAttr: "data-task-edit-dialog",
      formAttr: "data-task-edit-form",
      title: "Edit task",
      submitLabel: "Save",
      messageAttr: "data-task-edit-message",
      submitAttr: "data-task-edit-submit",
      cancelAttr: "data-task-edit-cancel",
      mode: "edit"
    })}

    <dialog class="task-dialog checklist-dialog" data-checklist-dialog>
      <div class="dialog-body">
        <div class="dialog-title-row">
          <h2 class="checklist-dialog-title" data-checklist-dialog-title>Checklist</h2>
          <button class="dialog-close-btn" type="button" aria-label="Close" data-dialog-close>✕</button>
        </div>
        <section class="checklist-panel" data-task-checklist>
          <div class="checklist-header">
            <span class="checklist-progress-text" data-checklist-progress>0 / 0</span>
          </div>
          <div class="checklist-bar">
            <div class="checklist-bar-fill" data-checklist-bar-fill style="width: 0%"></div>
          </div>
          <ul class="checklist-list" data-checklist-list></ul>
          <div class="checklist-add">
            <input
              type="text"
              placeholder="Add an item..."
              maxlength="200"
              data-checklist-input
              autocomplete="off"
            />
            <button type="button" class="checklist-add-btn" data-checklist-add>Add</button>
          </div>
        </section>
      </div>
    </dialog>

    <dialog class="task-dialog" data-task-delete-dialog>
      <div class="dialog-body">
        <div class="dialog-title-row">
          <h2>Delete task</h2>
          <button class="dialog-close-btn" type="button" aria-label="Close" data-dialog-close>✕</button>
        </div>
        <p data-task-delete-message>Are you sure you want to delete this task?</p>
        <div class="dialog-actions">
          <button class="btn-secondary" type="button" data-task-delete-cancel>Cancel</button>
          <button class="btn-danger" type="button" data-task-delete-confirm>Delete</button>
        </div>
      </div>
    </dialog>
  `;

  renderHeader(document.querySelector("[data-header]"), "/projects");
  renderFooter(document.querySelector("[data-footer]"));

  const commentToggleBtn = document.querySelector("[data-comment-thread-toggle]");
  const commentThreadSection = document.querySelector("[data-project-comments]");
  if (commentToggleBtn && commentThreadSection) {
    commentToggleBtn.addEventListener("click", () => {
      const collapsed = commentThreadSection.classList.toggle("is-collapsed");
      commentToggleBtn.textContent = collapsed ? "Show" : "Hide";
    });
  }

  const messageEl = document.querySelector("[data-taskboard-message]");
  const createButton = document.querySelector("[data-create-task]");
  const dialog = document.querySelector("[data-task-dialog]");
  const editDialog = document.querySelector("[data-task-edit-dialog]");
  const createEditor = dialog ? createTaskEditor(dialog) : null;
  const editEditor = editDialog ? createTaskEditor(editDialog) : null;
  const form = createEditor?.form;
  const formMessage = createEditor?.messageEl;
  const cancelButton = createEditor?.cancelButton;
  const submitButton = createEditor?.submitButton;
  const editForm = editEditor?.form;
  const editMessage = editEditor?.messageEl;
  const editCancel = editEditor?.cancelButton;
  const editSubmit = editEditor?.submitButton;
  const deleteDialog = document.querySelector("[data-task-delete-dialog]");
  const deleteMessage = document.querySelector("[data-task-delete-message]");
  const deleteCancel = document.querySelector("[data-task-delete-cancel]");
  const deleteConfirm = document.querySelector("[data-task-delete-confirm]");
  const createFields = createEditor?.fields;
  const editFields = editEditor?.fields;
  const projectCommentSection = document.querySelector("[data-project-comments]");
  const projectCommentList = projectCommentSection?.querySelector("[data-project-comment-list]");
  const projectCommentForm = projectCommentSection?.querySelector("[data-project-comment-form]");
  const projectCommentInput = projectCommentSection?.querySelector("[data-project-comment-input]");
  const projectCommentMessage = projectCommentSection?.querySelector("[data-project-comment-message]");
  const projectCommentSubmit = projectCommentSection?.querySelector("[data-project-comment-submit]");
  const projectCommentCancel = projectCommentSection?.querySelector("[data-project-comment-cancel]");
  const projectCommentCount = projectCommentSection?.querySelector("[data-project-comment-count]");
  const taskCommentElements = editEditor?.comments;

  let activeTaskId = null;
  let activeTaskCard = null;
  let taskCommentChannel = null;
  let projectCommentChannel = null;
  let taskReactionChannel = null;
  let projectReactionChannel = null;

  const projectComments = projectCommentList
    ? createCommentManager({
        listEl: projectCommentList,
        formEl: projectCommentForm,
        inputEl: projectCommentInput,
        messageEl: projectCommentMessage,
        submitButton: projectCommentSubmit,
        cancelButton: projectCommentCancel,
        countEl: projectCommentCount,
        currentUserId: userId,
        canModerate: isOwner,
        targetType: "project"
      })
    : null;

  if (projectComments) {
    projectComments.setTargetId(projectId);
    projectComments.setMembers(projectMembers);
    try {
      const projectCommentRows = await fetchCommentsByProject(projectId);
      projectComments.setComments(projectCommentRows);
      projectCommentChannel = subscribeToComments({
        targetType: "project",
        targetId: projectId,
        manager: projectComments
      });
      projectReactionChannel = subscribeToCommentReactions(projectComments);
    } catch (error) {
      projectComments.setMessage(error.message, true);
    }
  }

  const taskComments = taskCommentElements?.listEl
    ? createCommentManager({
        listEl: taskCommentElements.listEl,
        formEl: null,
        inputEl: taskCommentElements.inputEl,
        messageEl: taskCommentElements.messageEl,
        submitButton: taskCommentElements.submitButton,
        cancelButton: taskCommentElements.cancelButton,
        countEl: taskCommentElements.countEl,
        currentUserId: userId,
        canModerate: isOwner,
        targetType: "task"
      })
    : null;

  if (taskComments) {
    taskComments.setMembers(projectMembers);
  }

  const timerManager = editEditor?.timer
    ? createTimerManager({
        displayEl: editEditor.timer.display,
        toggleEl: editEditor.timer.toggle,
        messageEl: editEditor.timer.message,
        currentUserId: userId
      })
    : null;

  if (createEditor?.fields?.deadlineInput) {
    createEditor.fields.deadlineInput.addEventListener("change", () => {
      updateDeadlineHint(createEditor.fields.deadlineInput.value, createEditor.fields.deadlineHint);
    });
  }

  if (editEditor?.fields?.deadlineInput) {
    editEditor.fields.deadlineInput.addEventListener("change", () => {
      updateDeadlineHint(editEditor.fields.deadlineInput.value, editEditor.fields.deadlineHint);
    });
  }

  const checklistDialog = document.querySelector("[data-checklist-dialog]");
  const checklistDialogTitle = checklistDialog?.querySelector("[data-checklist-dialog-title]");
  const checklistDialogRoot = checklistDialog?.querySelector("[data-task-checklist]");
  const checklistManager = checklistDialogRoot
    ? createChecklistManager({
        listEl: checklistDialogRoot.querySelector("[data-checklist-list]"),
        inputEl: checklistDialogRoot.querySelector("[data-checklist-input]"),
        addBtnEl: checklistDialogRoot.querySelector("[data-checklist-add]"),
        progressEl: checklistDialogRoot.querySelector("[data-checklist-progress]"),
        barFillEl: checklistDialogRoot.querySelector("[data-checklist-bar-fill]")
      })
    : null;

  const loadTaskComments = async (taskId) => {
    if (!taskComments) {
      return;
    }

    taskComments.setTargetId(taskId);
    taskComments.setMessage("");

    try {
      const taskCommentRows = await fetchCommentsByTask(taskId);
      taskComments.setComments(taskCommentRows);
    } catch (error) {
      taskComments.setMessage(error.message, true);
    }

    if (taskCommentChannel) {
      supabase.removeChannel(taskCommentChannel);
    }

    taskCommentChannel = subscribeToComments({
      targetType: "task",
      targetId: taskId,
      manager: taskComments
    });

    if (taskReactionChannel) {
      supabase.removeChannel(taskReactionChannel);
    }

    taskReactionChannel = subscribeToCommentReactions(taskComments);
  };

  // Generic X-button close — routes to the dialog's existing cancel/close button
  document.addEventListener("click", (event) => {
    const xBtn = event.target.closest("[data-dialog-close]");
    if (!xBtn) return;
    const dlg = xBtn.closest("dialog");
    if (!dlg) return;
    const cancelBtn = dlg.querySelector(
      "[data-task-editor-cancel], [data-task-delete-cancel]"
    );
    if (cancelBtn) cancelBtn.click();
    else dlg.close();
  });

  if (!stageList.length && createButton) {
    createButton.disabled = true;
  }

  const openCreateDialog = (preselectedStageId) => {
    if (!dialog) return;
    if (formMessage) {
      formMessage.textContent = "";
      formMessage.classList.remove("is-error");
    }
    if (form) form.reset();
    if (createEditor?.attachments) createEditor.attachments.clear();
    if (createFields?.stageSelect && preselectedStageId) {
      createFields.stageSelect.value = preselectedStageId;
    }
    if (createFields?.statusOpen) {
      createFields.statusOpen.checked = true;
    }
    if (createFields?.deadlineHint) {
      createFields.deadlineHint.textContent = "";
      createFields.deadlineHint.className = "deadline-hint";
    }
    dialog.showModal();
  };

  if (createButton && dialog) {
    createButton.addEventListener("click", () => openCreateDialog());
  }

  app.addEventListener("click", (event) => {
    const addBtn = event.target.closest("[data-column-add-task]");
    if (!addBtn) return;
    openCreateDialog(addBtn.dataset.columnAddTask);
  });

  if (cancelButton && dialog) {
    cancelButton.addEventListener("click", () => {
      if (createEditor?.attachments) {
        createEditor.attachments.reset();
      }
      dialog.close();
    });
  }

  if (dialog && createEditor?.attachments) {
    dialog.addEventListener("close", () => {
      createEditor.attachments.reset();
    });
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (formMessage) {
        formMessage.textContent = "";
        formMessage.classList.remove("is-error");
      }

      const title = String(createFields?.titleInput?.value || "").trim();
      const description = String(createFields?.descriptionInput?.value || "").trim();
      const stageId = String(createFields?.stageSelect?.value || "");
      const priority = String(createFields?.prioritySelect?.value || "medium");
      const explicitDone = createFields?.statusClosed?.checked ?? false;
      const deadlineRaw = createFields?.deadlineInput?.value || "";
      const deadline = deadlineRaw ? new Date(deadlineRaw).toISOString() : null;

      if (!title) {
        if (formMessage) {
          formMessage.textContent = "Title is required.";
          formMessage.classList.add("is-error");
        }
        return;
      }

      const targetList = document.querySelector(
        `.taskboard-column[data-stage-id="${stageId}"] .task-list`
      );
      if (!targetList) {
        if (formMessage) {
          formMessage.textContent = "Selected stage is not available.";
          formMessage.classList.add("is-error");
        }
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = "Creating...";

      const stageInfo = stageMeta.get(stageId);
      const doneFlag = Boolean(stageInfo?.done) || explicitDone;
      const statusValue = explicitDone ? "done" : resolveStageStatus(stageInfo?.name);
      const descriptionHtml = description ? `<p>${escapeHtml(description)}</p>` : null;
      const position = targetList.querySelectorAll(".task-card").length;
      const existingPositions = [...targetList.querySelectorAll(".task-card")]
        .map((card) => Number(card.dataset.position))
        .filter((value) => Number.isFinite(value));
      const nextPosition = existingPositions.length
        ? Math.max(...existingPositions) + 1
        : position;

      const { data: newTask, error: insertError } = await supabase
        .from("tasks")
        .insert({
          project_id: projectId,
          stage_id: stageId,
          title,
          description_html: descriptionHtml,
          description: description || null,
          position: nextPosition,
          done: doneFlag,
          status: statusValue,
          priority,
          deadline,
          user_id: userId,
          created_by_user_id: userId
        })
        .select("id, title, description_html, position, stage_id, done, status, priority, deadline, created_at")
        .single();

      submitButton.disabled = false;
      submitButton.textContent = "Create";

      if (insertError) {
        if (formMessage) {
          formMessage.textContent = insertError.message;
          if (insertError.message.includes("row-level security")) {
            formMessage.textContent =
              "You do not have permission to add tasks to this project.";
          }
          formMessage.classList.add("is-error");
        }
        return;
      }

      const cardMarkup = renderTaskCard(newTask, stageId, stageInfo?.name, doneFlag);
      const empty = targetList.querySelector(".task-empty");
      if (empty) {
        empty.remove();
      }

      targetList.insertAdjacentHTML("beforeend", cardMarkup);
      const newCard = targetList.querySelector(`[data-task-id="${newTask.id}"]`);
      if (newCard) {
        wireTaskCard(newCard);
      }
      taskTimers.set(newTask.id, {
        totalSeconds: 0,
        timerRunning: false,
        timerStartedAt: null,
        intervalId: null
      });

      updateColumnCounts();
      messageEl.textContent = "";

      submitButton.disabled = true;
      submitButton.textContent = "Saving attachments...";

      try {
        await persistAttachmentChanges(newTask.id, createEditor?.attachments, userId);
        if (newCard) {
          const coverUrl = await fetchTaskCoverUrl(newTask.id);
          updateTaskCardCover(newCard, coverUrl, newTask.title);
        }
      } catch (attachmentError) {
        if (messageEl) {
          messageEl.textContent =
            "Task created, but attachments could not be saved. Edit the task to retry.";
          messageEl.classList.add("is-error");
        }
      }

      submitButton.disabled = false;
      submitButton.textContent = "Create";
      showToast("Task created");
      dialog.close();
      form.reset();
      if (createEditor?.attachments) {
        createEditor.attachments.clear();
      }
    });
  }

  app.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-task-edit]");
    if (!button) return;
    activeTaskId = button.dataset.taskId || null;
    activeTaskCard = button.closest(".task-card");
    if (editFields?.titleInput) {
      editFields.titleInput.value = button.dataset.taskTitle || "";
    }
    if (editFields?.descriptionInput) {
      editFields.descriptionInput.value = button.dataset.taskDescription || "";
    }
    if (editFields?.prioritySelect) {
      editFields.prioritySelect.value = button.dataset.taskPriority || "medium";
    }
    if (editFields?.statusClosed && editFields?.statusOpen) {
      const closed = button.dataset.taskDone === "true" || button.dataset.taskStatus === "done";
      editFields.statusClosed.checked = closed;
      editFields.statusOpen.checked = !closed;
    }
    if (editFields?.deadlineInput) {
      editFields.deadlineInput.value = toDateInputValue(button.dataset.taskDeadline || "");
      updateDeadlineHint(editFields.deadlineInput.value, editFields.deadlineHint);
    }
    if (editMessage) {
      editMessage.textContent = "";
      editMessage.classList.remove("is-error");
    }

    if (activeTaskId && editEditor?.attachments) {
      try {
        await refreshAttachmentEditor(activeTaskId, editEditor.attachments);
      } catch (attachmentError) {
        if (editMessage) {
          editMessage.textContent = attachmentError.message;
          editMessage.classList.add("is-error");
        }
      }
    }

    if (activeTaskId) {
      await loadTaskComments(activeTaskId);
    }

    if (activeTaskId && timerManager) {
      try {
        const timerState = await fetchTaskTimerState(activeTaskId);
        timerManager.init(timerState);
      } catch (_timerErr) {
        // non-critical
      }
    }

    editDialog.showModal();
  });

  if (editCancel) {
    editCancel.addEventListener("click", () => {
      if (timerManager) {
        timerManager.cleanup();
      }
      if (editEditor?.attachments) {
        editEditor.attachments.reset();
      }
      if (taskComments) {
        taskComments.setComments([]);
        taskComments.resetForm();
      }
      if (taskCommentChannel) {
        supabase.removeChannel(taskCommentChannel);
        taskCommentChannel = null;
      }
      if (taskReactionChannel) {
        supabase.removeChannel(taskReactionChannel);
        taskReactionChannel = null;
      }
      editDialog.close();
    });
  }

  if (editDialog && editEditor?.attachments) {
    editDialog.addEventListener("close", async () => {
      if (timerManager) {
        timerManager.cleanup();
      }
      editEditor.attachments.reset();
      if (taskComments) {
        taskComments.setComments([]);
        taskComments.resetForm();
      }
      if (taskCommentChannel) {
        supabase.removeChannel(taskCommentChannel);
        taskCommentChannel = null;
      }
      if (taskReactionChannel) {
        supabase.removeChannel(taskReactionChannel);
        taskReactionChannel = null;
      }
      // Re-sync card timer in case it was started/stopped inside the dialog
      if (activeTaskId) {
        try {
          const freshState = await fetchTaskTimerState(activeTaskId);
          const cardState = taskTimers.get(activeTaskId);
          if (cardState) {
            stopCardTimerInterval(activeTaskId);
            cardState.totalSeconds = freshState.total_tracked_seconds || 0;
            cardState.timerRunning = freshState.timer_running || false;
            cardState.timerStartedAt = freshState.timer_started_at || null;
            updateCardTimerUI(activeTaskId);
            if (cardState.timerRunning) {
              startCardTimerInterval(activeTaskId);
            }
          }
        } catch (_) {
          // non-critical
        }
      }
    });
  }

  if (editForm) {
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (editMessage) {
        editMessage.textContent = "";
        editMessage.classList.remove("is-error");
      }

      if (!activeTaskId) {
        if (editMessage) {
          editMessage.textContent = "Missing task id.";
          editMessage.classList.add("is-error");
        }
        return;
      }

      const title = String(editFields?.titleInput?.value || "").trim();
      const description = String(editFields?.descriptionInput?.value || "").trim();
      const priority = String(editFields?.prioritySelect?.value || "medium");
      const done = editFields?.statusClosed?.checked ?? false;
      const deadlineRaw = editFields?.deadlineInput?.value || "";
      const deadline = deadlineRaw ? new Date(deadlineRaw).toISOString() : null;

      if (!title) {
        if (editMessage) {
          editMessage.textContent = "Title is required.";
          editMessage.classList.add("is-error");
        }
        return;
      }

      editSubmit.disabled = true;
      editSubmit.textContent = "Saving...";

      const descriptionHtml = description ? `<p>${escapeHtml(description)}</p>` : null;
      const editBtn = activeTaskCard ? activeTaskCard.querySelector('[data-task-edit]') : null;
      const currentStatus = editBtn?.dataset.taskStatus || "";
      const currentStageId = activeTaskCard?.dataset.stageId || "";
      const currentStageInfo = stageMeta.get(currentStageId);
      const currentDoneFlag = Boolean(currentStageInfo?.done);

      const openPreferredStatus = currentStatus === "in_progress" ? "in_progress" : "todo";
      const openStageByStatus = findStageIdByStatus(stageMeta, openPreferredStatus);
      const openFallbackStage = findFirstStageIdByDone(stageMeta, false);
      const doneStage = findFirstStageIdByDone(stageMeta, true);

      const targetStageId = done
        ? currentDoneFlag
          ? currentStageId
          : (doneStage || currentStageId)
        : !currentDoneFlag
          ? currentStageId
          : (openStageByStatus || openFallbackStage || currentStageId);

      const targetStageInfo = stageMeta.get(targetStageId) || currentStageInfo;
      const targetDoneFlag = Boolean(targetStageInfo?.done);
      const statusValue = resolveStageStatus(targetStageInfo?.name);

      const targetList = document.querySelector(
        `.taskboard-column[data-stage-id="${targetStageId}"] .task-list`
      );
      const targetPosition = targetList ? targetList.querySelectorAll(".task-card").length : 0;

      const { error } = await supabase
        .from("tasks")
        .update({
          title,
          description_html: descriptionHtml,
          description: description || null,
          priority,
          deadline,
          stage_id: targetStageId,
          done: targetDoneFlag,
          status: statusValue,
          position: targetPosition
        })
        .eq("id", activeTaskId);

      editSubmit.disabled = false;
      editSubmit.textContent = "Save";

      if (error) {
        if (editMessage) {
          editMessage.textContent = error.message;
          editMessage.classList.add("is-error");
        }
        return;
      }

      editSubmit.disabled = true;
      editSubmit.textContent = "Saving attachments...";

      try {
        await persistAttachmentChanges(activeTaskId, editEditor?.attachments, userId);
        if (activeTaskCard) {
          const coverUrl = await fetchTaskCoverUrl(activeTaskId);
          updateTaskCardCover(activeTaskCard, coverUrl, title);
        }
      } catch (attachmentError) {
        editSubmit.disabled = false;
        editSubmit.textContent = "Save";
        if (editMessage) {
          editMessage.textContent = attachmentError.message;
          editMessage.classList.add("is-error");
        }
        return;
      }

      editSubmit.disabled = false;
      editSubmit.textContent = "Save";

      if (activeTaskCard) {
        const titleEl = activeTaskCard.querySelector("[data-task-title]");
        const descEl = activeTaskCard.querySelector(".task-description");
        if (titleEl) {
          titleEl.textContent = title;
        }
        if (descEl) {
          descEl.textContent = description || "No description yet.";
        }
        const editBtn = activeTaskCard.querySelector('[data-task-edit]');
        if (editBtn) {
          editBtn.dataset.taskDone = targetDoneFlag ? 'true' : 'false';
          editBtn.dataset.taskStatus = statusValue;
          editBtn.dataset.taskTitle = title;
          editBtn.dataset.taskDescription = description;
          editBtn.dataset.taskPriority = priority;
          editBtn.dataset.taskDeadline = deadline || "";
        }
        const existingDeadlineBadge = activeTaskCard.querySelector("[data-deadline-badge]");
        const deadlineInfo = resolveDeadlineState(deadline);
        if (deadlineInfo) {
          const badgeHtml = `<span class="deadline-badge is-${deadlineInfo.state}" data-deadline-badge>📅 ${deadlineInfo.label}</span>`;
          if (existingDeadlineBadge) {
            existingDeadlineBadge.outerHTML = badgeHtml;
          } else {
            const metaRow = activeTaskCard.querySelectorAll(".task-meta")[1];
            if (metaRow) metaRow.insertAdjacentHTML("beforeend", badgeHtml);
          }
        } else if (existingDeadlineBadge) {
          existingDeadlineBadge.remove();
        }

        const sourceList = activeTaskCard.closest(".task-list");
        if (targetList && sourceList && sourceList !== targetList) {
          const targetEmpty = targetList.querySelector(".task-empty");
          if (targetEmpty) {
            targetEmpty.remove();
          }
          targetList.appendChild(activeTaskCard);
        }

        activeTaskCard.dataset.stageId = targetStageId;
        updateTaskStatus(activeTaskCard, targetStageInfo?.name, targetDoneFlag);

        if (sourceList) {
          ensureEmptyState(sourceList);
        }
        if (targetList) {
          ensureEmptyState(targetList);
        }
        updateColumnCounts();

        messageEl.textContent = "";
        messageEl.classList.remove("is-error");
        try {
          if (sourceList && currentStageId && currentStageId !== targetStageId) {
            const sourceStatus = resolveStageStatus(currentStageInfo?.name);
            await persistListOrder(sourceList, currentStageId, currentDoneFlag, sourceStatus);
          }

          if (targetList) {
            await persistListOrder(targetList, targetStageId, targetDoneFlag, statusValue);
          }
        } catch (persistError) {
          if (editMessage) {
            editMessage.textContent = persistError.message;
            editMessage.classList.add("is-error");
          }
          return;
        }
      }

      editDialog.close();
      showToast("Task saved");
    });
  }

  app.addEventListener("click", (event) => {
    const button = event.target.closest("[data-task-delete]");
    if (!button) return;
    activeTaskId = button.dataset.taskId || null;
    activeTaskCard = button.closest(".task-card");
    deleteMessage.textContent = "Are you sure you want to delete this task?";
    deleteDialog.showModal();
  });

  if (deleteCancel) {
    deleteCancel.addEventListener("click", () => {
      deleteDialog.close();
    });
  }

  if (deleteConfirm) {
    deleteConfirm.addEventListener("click", async () => {
      if (!activeTaskId) {
        deleteDialog.close();
        return;
      }

      deleteConfirm.disabled = true;
      deleteConfirm.textContent = "Deleting...";

      const { error } = await supabase.from("tasks").delete().eq("id", activeTaskId);

      deleteConfirm.disabled = false;
      deleteConfirm.textContent = "Delete";

      if (error) {
        deleteMessage.textContent = error.message;
        return;
      }

      if (activeTaskCard) {
        const list = activeTaskCard.closest(".task-list");
        activeTaskCard.remove();
        if (list && !list.querySelector(".task-card")) {
          list.insertAdjacentHTML(
            "beforeend",
            '<li class="task-empty">No tasks in this stage.</li>'
          );
        }
      }

      stopCardTimerInterval(activeTaskId);
      taskTimers.delete(activeTaskId);
      updateColumnCounts();
      showToast("Task deleted");
      deleteDialog.close();
    });
  }

  // Checklist dialog — open via event delegation (works for all cards incl. newly created)
  let checklistActiveCard = null;
  app.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-task-open-checklist]");
    if (!btn) return;
    const taskId = btn.dataset.taskId || null;
    const title = btn.dataset.taskTitle || "Checklist";
    checklistActiveCard = btn.closest(".task-card");
    if (checklistDialogTitle) checklistDialogTitle.textContent = title;
    if (checklistManager && taskId) {
      checklistManager.setTaskId(taskId);
      try {
        const items = await fetchChecklistItems(taskId);
        checklistManager.setItems(items);
      } catch (_) {
        // non-critical
      }
    }
    checklistDialog?.showModal();
  });

  if (checklistDialog) {
    checklistDialog.addEventListener("close", () => {
      if (checklistManager) {
        updateTaskCardChecklistBadge(checklistActiveCard, checklistManager.getChecklistCounts());
        checklistManager.setTaskId(null);
      }
      checklistActiveCard = null;
    });
  }

  if (stageList.length) {
    setupTaskDragAndDrop(stageMeta, messageEl);
  }

  // Start live tick for tasks whose timers were already running on page load
  taskTimers.forEach((state, taskId) => {
    if (state.timerRunning) {
      startCardTimerInterval(taskId);
    }
  });

  // ── Real-time task sync ──────────────────────────────────────────────────
  supabase
    .channel(`tasks:project:${projectId}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "tasks",
      filter: `project_id=eq.${projectId}`
    }, (payload) => {
      const task = payload.new;
      if (!task?.id) return;
      if (document.querySelector(`.task-card[data-task-id="${task.id}"]`)) return;

      const stageId = task.stage_id;
      const targetList = document.querySelector(`.taskboard-column[data-stage-id="${stageId}"] .task-list`);
      if (!targetList) return;

      const stageInfo = stageMeta.get(stageId);
      const doneFlag = Boolean(stageInfo?.done);

      taskTimers.set(task.id, {
        totalSeconds: task.total_tracked_seconds || 0,
        timerRunning: Boolean(task.timer_running),
        timerStartedAt: task.timer_started_at || null,
        intervalId: null
      });
      if (Boolean(task.timer_running)) startCardTimerInterval(task.id);

      const empty = targetList.querySelector(".task-empty");
      if (empty) empty.remove();
      targetList.insertAdjacentHTML("beforeend", renderTaskCard(task, stageId, stageInfo?.name, doneFlag));

      const newCard = targetList.querySelector(`.task-card[data-task-id="${task.id}"]`);
      if (newCard) wireTaskCard(newCard);

      updateColumnCounts();
      showToast("New task added");
    })
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "tasks",
      filter: `project_id=eq.${projectId}`
    }, (payload) => {
      const task = payload.new;
      if (!task?.id) return;

      const card = document.querySelector(`.task-card[data-task-id="${task.id}"]`);
      if (!card) return;

      const titleEl = card.querySelector("[data-task-title]");
      if (titleEl) titleEl.textContent = task.title || "Untitled task";

      const descEl = card.querySelector(".task-description");
      if (descEl) {
        const descText = stripHtml(task.description_html || "");
        descEl.textContent = descText || "No description yet.";
      }

      const priorityEl = card.querySelector(".priority-badge");
      if (priorityEl) {
        const priority = task.priority || "medium";
        priorityEl.textContent = priority;
        priorityEl.className = `priority-badge priority-${priority}`;
      }

      const existingDeadlineBadge = card.querySelector("[data-deadline-badge]");
      const deadlineInfo = resolveDeadlineState(task.deadline);
      if (deadlineInfo) {
        const badgeHtml = `<span class="deadline-badge is-${deadlineInfo.state}" data-deadline-badge>📅 ${deadlineInfo.label}</span>`;
        if (existingDeadlineBadge) {
          existingDeadlineBadge.outerHTML = badgeHtml;
        } else {
          const metaRow = card.querySelectorAll(".task-meta")[1];
          if (metaRow) metaRow.insertAdjacentHTML("beforeend", badgeHtml);
        }
      } else if (existingDeadlineBadge) {
        existingDeadlineBadge.remove();
      }

      const editBtn = card.querySelector("[data-task-edit]");
      if (editBtn) {
        const safeTitle = escapeHtml(task.title || "Untitled task");
        editBtn.dataset.taskTitle = safeTitle;
        editBtn.dataset.taskDescription = escapeHtml(stripHtml(task.description_html || ""));
        editBtn.dataset.taskPriority = task.priority || "medium";
        editBtn.dataset.taskDone = task.done ? "true" : "false";
        editBtn.dataset.taskStatus = task.status || "";
        editBtn.dataset.taskDeadline = task.deadline || "";
      }

      const newTimerRunning = Boolean(task.timer_running);
      const timerState = taskTimers.get(task.id);
      if (timerState && timerState.timerRunning !== newTimerRunning) {
        stopCardTimerInterval(task.id);
        timerState.totalSeconds = task.total_tracked_seconds || 0;
        timerState.timerRunning = newTimerRunning;
        timerState.timerStartedAt = task.timer_started_at || null;
        updateCardTimerUI(task.id);
        if (newTimerRunning) startCardTimerInterval(task.id);
      }

      const currentStageId = card.dataset.stageId;
      if (task.stage_id && task.stage_id !== currentStageId) {
        const targetList = document.querySelector(`.taskboard-column[data-stage-id="${task.stage_id}"] .task-list`);
        if (targetList) {
          const sourceList = card.closest(".task-list");
          const targetEmpty = targetList.querySelector(".task-empty");
          if (targetEmpty) targetEmpty.remove();
          targetList.appendChild(card);
          card.dataset.stageId = task.stage_id;
          if (sourceList) ensureEmptyState(sourceList);
          ensureEmptyState(targetList);
        }
      }

      const newStageInfo = stageMeta.get(task.stage_id || currentStageId);
      updateTaskStatus(card, newStageInfo?.name, Boolean(newStageInfo?.done));
      updateColumnCounts();
    })
    .on("postgres_changes", {
      event: "DELETE",
      schema: "public",
      table: "tasks",
      filter: `project_id=eq.${projectId}`
    }, (payload) => {
      const taskId = payload.old?.id;
      if (!taskId) return;

      const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
      if (!card) return;

      stopCardTimerInterval(taskId);
      taskTimers.delete(taskId);

      const list = card.closest(".task-list");
      card.remove();
      if (list) ensureEmptyState(list);
      updateColumnCounts();
    })
    .subscribe();
  // ── End real-time task sync ──────────────────────────────────────────────

  // Timer Start/Stop handler — event delegation on the whole taskboard grid
  const taskboardGrid = document.querySelector(".taskboard-grid");
  if (taskboardGrid) {
    taskboardGrid.addEventListener("click", async (event) => {
      const toggleBtn = event.target.closest("[data-timer-toggle]");
      if (!toggleBtn || toggleBtn.disabled) return;

      const taskId = toggleBtn.dataset.taskId;
      if (!taskId) return;

      const state = taskTimers.get(taskId);
      if (!state) return;

      toggleBtn.disabled = true;

      try {
        if (state.timerRunning) {
          const now = new Date();
          const elapsed = state.timerStartedAt
            ? Math.max(
                0,
                Math.floor((now.getTime() - new Date(state.timerStartedAt).getTime()) / 1000)
              )
            : 0;
          const newTotal = state.totalSeconds + elapsed;

          const { error: taskError } = await supabase
            .from("tasks")
            .update({
              total_tracked_seconds: newTotal,
              timer_running: false,
              timer_started_at: null
            })
            .eq("id", taskId);
          if (taskError) throw new Error(taskError.message);

          const { data: openEntry } = await supabase
            .from("task_time_entries")
            .select("id")
            .eq("task_id", taskId)
            .is("ended_at", null)
            .order("started_at", { ascending: false })
            .limit(1)
            .single();

          if (openEntry?.id) {
            await supabase
              .from("task_time_entries")
              .update({ ended_at: now.toISOString(), duration_seconds: elapsed })
              .eq("id", openEntry.id);
          }

          stopCardTimerInterval(taskId);
          state.totalSeconds = newTotal;
          state.timerRunning = false;
          state.timerStartedAt = null;
          updateCardTimerUI(taskId);
        } else {
          const now = new Date();

          const { data: entry, error: entryError } = await supabase
            .from("task_time_entries")
            .insert({ task_id: taskId, user_id: userId, started_at: now.toISOString() })
            .select("id")
            .single();
          if (entryError) throw new Error(entryError.message);

          const { error: taskError } = await supabase
            .from("tasks")
            .update({ timer_running: true, timer_started_at: now.toISOString() })
            .eq("id", taskId);
          if (taskError) throw new Error(taskError.message);

          state.timerRunning = true;
          state.timerStartedAt = now.toISOString();
          updateCardTimerUI(taskId);
          startCardTimerInterval(taskId);
        }
      } catch (err) {
        if (messageEl) {
          messageEl.textContent = err.message;
          messageEl.classList.add("is-error");
        }
      }

      toggleBtn.disabled = false;
    });
  }
}

bootstrap().catch((error) => {
  app.innerHTML = `<p style="padding: 1rem; color: #b62541;">${escapeHtml(error.message)}</p>`;
});
