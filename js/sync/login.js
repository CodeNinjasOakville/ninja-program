// Sign-in, forgot-password and "choose your password" screens (drawn into #lock-root).

import { h } from "../core/dom.js";
import { passwordAdvice } from "../core/strength.js";

export const MIN_PASSWORD_LENGTH = 12;

const root = () => document.getElementById("lock-root");
export function hideLogin() { root().replaceChildren(); document.body.classList.remove("locked"); }

function card(...children) {
  const wrap = h("div", { class: "lock-wrap" }, h("div", { class: "lock-card" }, [
    h("div", { class: "lock-brand" }, "Ninja Program"), ...children,
  ]));
  root().replaceChildren(wrap);
  document.body.classList.add("locked");
}

function field(label, input, hint) {
  return h("div", { class: "lock-field" }, [h("label", { for: input.id }, label), input, hint]);
}

/** Shows the sign-in form. Resolves once signed in. */
export function showLogin(client, store, { notice = "", email = "" } = {}) {
  return new Promise((resolve) => {
    const error = h("div", { class: "lock-error", role: "alert" });
    const emailIn = h("input", { id: "loginEmail", type: "email", autocomplete: "username", required: true, value: email });
    const passIn = h("input", { id: "loginPassword", type: "password", autocomplete: "current-password", required: true });
    const remember = h("input", { id: "loginRemember", type: "checkbox" });
    remember.checked = store.remember;
    const button = h("button", { type: "submit", class: "btn-primary wide-btn" }, "Sign in");
    const forgot = h("button", { type: "button", class: "link-btn" }, "Forgot password?");
    forgot.addEventListener("click", () => resolve(showForgot(client, store, emailIn.value).then(() => showLogin(client, store, { email: emailIn.value }))));

    const form = h("form", { class: "lock-form", novalidate: true }, [
      field("Email", emailIn), field("Password", passIn),
      h("label", { class: "radio" }, [remember, " Keep me signed in on this device"]),
      error, button,
    ]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.className = "lock-error";
      if (!emailIn.value.trim() || !passIn.value) { error.textContent = "Enter your email and password."; error.className = "lock-error show"; return; }
      button.disabled = true; button.textContent = "Signing in...";
      store.remember = remember.checked;
      try {
        await client.signIn(emailIn.value, passIn.value);
        resolve();
      } catch (err) {
        error.textContent = err.message; error.className = "lock-error show";
        button.disabled = false; button.textContent = "Sign in"; passIn.select();
      }
    });
    card(
      h("p", { class: "lock-sub" }, "Sign in to continue"),
      notice ? h("p", { class: "warn" }, notice) : null,
      form,
      h("div", { class: "lock-foot" }, [forgot, h("p", { class: "hint" }, "Need an account? Ask the person who runs your Ninja Program to invite you.")])
    );
    (email ? passIn : emailIn).focus();
  });
}

function showForgot(client, store, email) {
  return new Promise((resolve) => {
    const msg = h("p", { class: "lock-error", role: "status" });
    const emailIn = h("input", { id: "forgotEmail", type: "email", autocomplete: "username", required: true, value: email || "" });
    const send = h("button", { type: "submit", class: "btn-primary wide-btn" }, "Email me a reset link");
    const back = h("button", { type: "button", class: "link-btn" }, "Back to sign in");
    back.addEventListener("click", () => resolve());
    const form = h("form", { class: "lock-form", novalidate: true }, [field("Your email", emailIn), msg, send]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!emailIn.value.trim()) return;
      send.disabled = true;
      try {
        await client.sendReset(emailIn.value, location.origin + location.pathname);
        msg.className = "warn"; msg.textContent = "If that email belongs to a team member, a reset link is on its way. Open it on this device.";
      } catch (err) { msg.className = "lock-error show"; msg.textContent = err.message; }
      send.disabled = false;
    });
    card(h("p", { class: "lock-sub" }, "Reset your password"), form, h("div", { class: "lock-foot" }, [back]));
    emailIn.focus();
  });
}

/** After an invite or reset link: choose a password. `tokens` come from the link. Resolves when done. */
export function showChoosePassword(client, tokens, { invite = false } = {}) {
  return new Promise((resolve) => {
    const error = h("div", { class: "lock-error", role: "alert" });
    const a = h("input", { id: "newPw", type: "password", autocomplete: "new-password", required: true });
    const b = h("input", { id: "newPw2", type: "password", autocomplete: "new-password", required: true });
    const strength = h("div", { class: "strength" });
    a.addEventListener("input", () => { const s = passwordAdvice(a.value); strength.dataset.level = s.level; strength.textContent = s.label ? `${s.label}. ${s.message}` : ""; });
    const button = h("button", { type: "submit", class: "btn-primary wide-btn" }, "Save password and continue");
    const form = h("form", { class: "lock-form", novalidate: true }, [
      h("input", { type: "text", autocomplete: "username", hidden: true, tabindex: "-1", "aria-hidden": "true" }),
      field("New password (at least 12 characters)", a, h("div", { class: "hint" }, "Tip: four or more random words joined together.")), strength,
      field("New password again", b), error, button,
    ]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.className = "lock-error";
      const fail = (m) => { error.textContent = m; error.className = "lock-error show"; };
      if (a.value.length < MIN_PASSWORD_LENGTH) return fail(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      if (a.value !== b.value) return fail("The two passwords don't match.");
      button.disabled = true;
      try {
        await client.adoptLinkTokens(tokens);
        await client.changePassword(a.value);
        resolve();
      } catch (err) {
        fail(err.status === 401 ? "This link has expired. Go back and ask for a new one." : err.message);
        button.disabled = false;
      }
    });
    card(h("p", { class: "lock-sub" }, invite ? "Welcome! Choose a password" : "Choose a new password"), form);
    a.focus();
  });
}

export function showMessage(text, { retry } = {}) {
  const children = [h("p", { class: "lock-error show" }, text)];
  if (retry) { const b = h("button", { type: "button", class: "btn-primary wide-btn" }, "Try again"); b.addEventListener("click", retry); children.push(b); }
  card(...children);
}
