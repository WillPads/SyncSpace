// Interactive terminal client for the SyncSpace server: `npm run cli` (the server must be running).
// It uses the same REST and WebSocket API as the web app, so everything you do here is real.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { WebSocket } from "ws";

const BASE = (process.env.SYNCSPACE_URL ?? "http://localhost:4000").replace(/\/+$/, "");

class Quit extends Error {}

// ---------------------------------------------------------------------------------------
// Input: a queue of lines, so the program works when typed and when piped in.
// ---------------------------------------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin });
const buffered = [];
const waiting = [];
let inputClosed = false;
rl.on("line", (line) => (waiting.length ? waiting.shift()(line) : buffered.push(line)));
rl.on("close", () => {
  inputClosed = true;
  for (const resolve of waiting.splice(0)) resolve(null);
});

function askCancelable(prompt) {
  process.stdout.write(prompt);
  let entry;
  const promise = new Promise((resolve) => {
    if (buffered.length) return resolve(buffered.shift());
    if (inputClosed) return resolve(null);
    entry = resolve;
    waiting.push(entry);
  });
  return {
    promise,
    cancel: () => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
    },
  };
}

async function ask(prompt) {
  const line = await askCancelable(prompt).promise;
  if (line === null) throw new Quit();
  return line.trim();
}

async function askDefault(prompt, fallback) {
  const answer = await ask(`${prompt} [${fallback}]: `);
  return answer === "" ? fallback : answer;
}

async function confirm(prompt) {
  return /^y(es)?$/i.test(await ask(`${prompt} (y/N): `));
}

const REFRESH = { label: "refresh", run: async () => {} };

/** Prints a numbered menu and returns the chosen item, or null for "0". Enter alone refreshes. */
async function pick(items, { back = "Back" } = {}) {
  items.forEach((item, index) => console.log(`  ${index + 1}. ${item.label}`));
  console.log(`  0. ${back}`);
  for (;;) {
    const answer = await ask("> ");
    if (answer === "0") return null;
    if (answer === "") return REFRESH;
    const item = items[Number(answer) - 1];
    if (item) return item;
    console.log("Type one of the numbers above (or press Enter to refresh).");
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------
// Server API
// ---------------------------------------------------------------------------------------
let cookie = "";
let me = null;

async function api(method, route, { json, form } = {}) {
  let res;
  try {
    res = await fetch(BASE + route, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(json ? { "Content-Type": "application/json" } : {}) },
      body: json ? JSON.stringify(json) : form,
    });
  } catch {
    throw new Error(`Can't reach the server at ${BASE}. Is it running? (npm run dev)`);
  }
  for (const header of res.headers.getSetCookie()) {
    const match = header.match(/^syncspace_session=([^;]*)/);
    if (match) cookie = match[1] ? `syncspace_session=${match[1]}` : "";
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const retry = res.headers.get("retry-after");
    throw new Error((body?.error ?? `The server answered ${res.status}.`) + (retry ? ` (try again in ${retry}s)` : ""));
  }
  return body;
}

// ---------------------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------------------
const mmss = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const PHASE_NAMES = { IDLE: "Idle", POMODORO_ACTIVE: "Focus", BREAK: "Break", QUIZ_PHASE: "Quiz time" };

function stateLine(room) {
  const session = room.session;
  if (!session) return "No timer";
  const left =
    session.isRunning && session.endsAt
      ? (Date.parse(session.endsAt) - Date.parse(room.serverTime)) / 1000
      : session.remainingSeconds;
  const timer =
    session.state === "IDLE" || session.state === "QUIZ_PHASE"
      ? ""
      : `  ${mmss(left)} left${session.isRunning ? "" : " (paused)"}`;
  return `${PHASE_NAMES[session.state]}${timer}   focus rounds done: ${session.sessionsCompleted}`;
}

// ---------------------------------------------------------------------------------------
// Signed-out menu
// ---------------------------------------------------------------------------------------
async function logIn() {
  const email = await ask("Email: ");
  const password = await ask("Password (shown as you type): ");
  me = (await api("POST", "/auth/login", { json: { email, password } })).user;
  console.log(`Welcome back, ${me.displayName}.`);
}

async function register() {
  const email = await ask("Email: ");
  const password = await ask("Password, 8+ characters (shown as you type): ");
  const displayName = await ask("Your name: ");
  me = (await api("POST", "/auth/register", { json: { email, password, displayName } })).user;
  console.log(`Account created. Welcome, ${me.displayName}.`);
}

async function authMenu() {
  console.log("\nNot signed in.");
  const item = await pick(
    [
      { label: "Log in", run: logIn },
      { label: "Create an account", run: register },
    ],
    { back: "Quit" }
  );
  if (!item) throw new Quit();
  await item.run();
}

// ---------------------------------------------------------------------------------------
// Signed-in menu
// ---------------------------------------------------------------------------------------
async function listRooms() {
  const { rooms } = await api("GET", "/rooms");
  if (rooms.length === 0) {
    console.log("You're not in any rooms yet. Create one or join with a code.");
    return;
  }
  console.log("\nYour rooms:");
  const item = await pick(
    rooms.map((room) => ({
      label: `${room.name}   [${room.code}]   ${PHASE_NAMES[room.session?.state ?? "IDLE"]}   ${room.participants.length} people`,
      run: () => roomScreen(room.id),
    }))
  );
  if (item) await item.run();
}

async function createRoom() {
  const name = await ask("Room name: ");
  if (!name) return;
  const focus = Number(await askDefault("Focus minutes", "25"));
  const rest = Number(await askDefault("Break minutes", "5"));
  const valid = (n) => Number.isInteger(n) && n >= 1 && n <= 240;
  if (!valid(focus) || !valid(rest)) {
    console.log("Enter whole minutes between 1 and 240.");
    return;
  }
  const open = !/^n/i.test(await askDefault("Let people join with the code? (y/n)", "y"));
  const { room } = await api("POST", "/rooms", {
    json: { name, focusDurationSec: focus * 60, breakDurationSec: rest * 60, inviteEnabled: open },
  });
  console.log(`Room created. Share this code: ${room.code}`);
  await roomScreen(room.id);
}

async function joinRoom() {
  const code = await ask("Room code: ");
  if (!code) return;
  const { room } = await api("POST", `/rooms/${encodeURIComponent(code.toUpperCase())}/join`, { json: {} });
  await roomScreen(room.id);
}

async function logOut() {
  await api("POST", "/auth/logout");
  me = null;
  cookie = "";
  console.log("Logged out.");
}

async function homeMenu() {
  console.log(`\n== SyncSpace — signed in as ${me.displayName} ==`);
  const item = await pick(
    [
      { label: "My rooms", run: listRooms },
      { label: "Create a room", run: createRoom },
      { label: "Join a room with a code", run: joinRoom },
      { label: "Log out", run: logOut },
    ],
    { back: "Quit" }
  );
  if (!item) throw new Quit();
  await item.run();
}

// ---------------------------------------------------------------------------------------
// Room screen
// ---------------------------------------------------------------------------------------
async function roomScreen(roomId) {
  for (;;) {
    const { room } = await api("GET", `/rooms/${roomId}`);
    const mine = room.participants.find((p) => p.userId === me.id);
    const admin = mine?.role === "ADMIN";

    console.log(`\n=== ${room.name}    code ${room.code} ===`);
    console.log(stateLine(room));
    console.log(`Invites: ${room.inviteEnabled ? "open" : "closed"}    You are: ${admin ? "the host" : "a member"}`);
    console.log(`People (${room.participants.length}/${room.capacity}):`);
    for (const p of room.participants) {
      const tags = `${p.role === "ADMIN" ? " (host)" : ""}${p.userId === me.id ? " (you)" : ""}`;
      console.log(`  - ${p.displayName}${tags}${p.task ? `   — ${p.task}` : ""}`);
    }

    const act = (action) => async () => {
      await api("POST", `/rooms/${roomId}/session`, { json: { action } });
    };
    const items = [];
    const state = room.session?.state;
    if (admin && state === "IDLE") items.push({ label: "Start a focus session", run: act("start") });
    if (admin && (state === "POMODORO_ACTIVE" || state === "BREAK")) {
      items.push(
        room.session.isRunning
          ? { label: "Pause the timer", run: act("pause") }
          : { label: "Resume the timer", run: act("resume") },
        { label: "Skip to the next phase", run: act("skip") },
        { label: "End the session (everyone moves to the quiz)", run: act("endSession") }
      );
    }
    if (admin && state === "QUIZ_PHASE") items.push({ label: "Back to idle (ready for a new session)", run: act("reset") });
    items.push(
      { label: "Set what I'm working on", run: () => setTask(roomId) },
      { label: "Upload notes (.txt, .md, .pdf)", run: () => uploadNotes(roomId) },
      { label: "Quizzes", run: () => quizzes(roomId) },
      { label: "Watch the room live", run: () => watch(roomId, room) }
    );
    if (admin) {
      items.push(
        {
          label: room.inviteEnabled ? "Close invites" : "Open invites",
          run: async () => {
            await api("PATCH", `/rooms/${roomId}/invite`, { json: { enabled: !room.inviteEnabled } });
          },
        },
        { label: "Remove someone from the room", run: () => removePerson(roomId, room) },
        { label: "Removed people (lift a ban)", run: () => bans(roomId) },
        { label: "Delete this room", run: () => deleteRoom(roomId) }
      );
    } else {
      items.push({ label: "Leave this room", run: () => leaveRoom(roomId) });
    }

    const item = await pick(items);
    if (!item) return;
    try {
      if ((await item.run()) === "left") return;
    } catch (err) {
      if (err instanceof Quit) throw err;
      console.log(`! ${err.message}`);
    }
  }
}

async function setTask(roomId) {
  const task = await ask("What are you working on? (blank clears it): ");
  await api("PATCH", `/rooms/${roomId}/task`, { json: { task } });
}

async function uploadNotes(roomId) {
  const typed = await ask("Path to a .txt, .md or .pdf file: ");
  const file = typed.replace(/^["']|["']$/g, "");
  if (!file) return;
  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    console.log("Couldn't read that file.");
    return;
  }
  const form = new FormData();
  form.append("file", new Blob([data]), path.basename(file));
  const { document } = await api("POST", `/rooms/${roomId}/documents`, { form });
  console.log(`Uploaded "${document.filename}". Processing...`);

  for (let attempt = 0; attempt < 90; attempt++) {
    await sleep(1000);
    const { documents } = await api("GET", `/rooms/${roomId}/documents`);
    const current = documents.find((d) => d.id === document.id);
    if (!current || current.status === "PENDING" || current.status === "PARSING") continue;
    if (current.status === "FAILED") {
      console.log(`Failed: ${current.failureReason ?? "unknown reason"}`);
      return;
    }
    const { quizzes: list } = await api("GET", `/rooms/${roomId}/quizzes`);
    const quiz = list.find((q) => q.documentId === document.id);
    console.log(
      quiz
        ? `Done. A quiz was made: ${quiz.questionCount} questions (${quiz.generatedBy === "LLM" ? "written by Claude" : "built-in generator"}).`
        : "Done, but the notes didn't have enough in them for a quiz."
    );
    return;
  }
  console.log("Still processing. Check Quizzes again in a moment.");
}

async function quizzes(roomId) {
  const { quizzes: list } = await api("GET", `/rooms/${roomId}/quizzes`);
  if (list.length === 0) {
    console.log("No quizzes yet. Upload some notes first.");
    return;
  }
  console.log("\nQuizzes:");
  const chosen = await pick(
    list.map((quiz) => ({
      label: `${quiz.title} — ${quiz.questionCount} questions (${quiz.generatedBy === "LLM" ? "Claude" : "built-in"})`,
      quiz,
    }))
  );
  if (!chosen || !chosen.quiz) return;
  const item = await pick([
    { label: "Take the quiz", run: () => takeQuiz(roomId, chosen.quiz.id) },
    { label: "See everyone's results", run: () => results(roomId, chosen.quiz.id) },
  ]);
  if (item) await item.run();
}

async function takeQuiz(roomId, quizId) {
  const { room } = await api("GET", `/rooms/${roomId}`);
  if (room.session?.state !== "QUIZ_PHASE") {
    console.log("Answers can only be submitted during the quiz phase. The host starts it by ending the session.");
    return;
  }
  const { quiz } = await api("GET", `/rooms/${roomId}/quizzes/${quizId}`);
  const letters = "ABCDEFGH";
  const responses = [];
  for (const [index, question] of quiz.questions.entries()) {
    console.log(`\nQ${index + 1}. ${question.prompt}`);
    question.choices.forEach((choice, i) => console.log(`   ${letters[i]}) ${choice.text}`));
    for (;;) {
      const answer = (await ask("Your answer: ")).toUpperCase();
      const i = letters.indexOf(answer);
      if (answer.length === 1 && i >= 0 && i < question.choices.length) {
        responses.push({ questionId: question.id, choiceId: question.choices[i].id });
        break;
      }
      console.log("Type one of the letters shown.");
    }
  }
  const result = await api("POST", `/rooms/${roomId}/quizzes/${quizId}/attempts`, { json: { responses } });
  console.log(`\nScore: ${result.score}/${result.total}`);
  quiz.questions.forEach((question, index) => {
    const right = question.choices.find((choice) => choice.id === result.correctChoices[question.id]);
    const mine = responses.find((r) => r.questionId === question.id);
    if (!right) return;
    console.log(`Q${index + 1}: ${mine.choiceId === right.id ? "correct" : `wrong — the answer was "${right.text}"`}`);
  });
}

async function results(roomId, quizId) {
  const data = await api("GET", `/rooms/${roomId}/quizzes/${quizId}/results`);
  if (data.results.length === 0) {
    console.log("Nobody has taken this quiz yet.");
    return;
  }
  console.log(`\nResults (first attempt counts, out of ${data.total}):`);
  for (const r of data.results) {
    console.log(`  ${r.displayName}: ${r.firstScore}   (best ${r.bestScore}, ${r.attempts} attempt${r.attempts === 1 ? "" : "s"})`);
  }
}

async function removePerson(roomId, room) {
  const others = room.participants.filter((p) => p.userId !== me.id);
  if (others.length === 0) {
    console.log("There's nobody else in the room.");
    return;
  }
  const item = await pick(others.map((p) => ({ label: p.displayName, person: p })));
  if (!item || !item.person) return;
  if (!(await confirm(`Remove ${item.person.displayName}? They can't rejoin until you lift the ban`))) return;
  await api("DELETE", `/rooms/${roomId}/participants/${item.person.userId}`);
  console.log(`${item.person.displayName} was removed.`);
}

async function bans(roomId) {
  const { bans: list } = await api("GET", `/rooms/${roomId}/bans`);
  if (list.length === 0) {
    console.log("Nobody is banned from this room.");
    return;
  }
  console.log("Pick someone to let back in:");
  const item = await pick(list.map((ban) => ({ label: ban.displayName, ban })));
  if (!item || !item.ban) return;
  await api("DELETE", `/rooms/${roomId}/bans/${item.ban.userId}`);
  console.log(`${item.ban.displayName} can join again with the code.`);
}

async function deleteRoom(roomId) {
  if ((await ask("This deletes the room for everyone. Type DELETE to confirm: ")) !== "DELETE") {
    console.log("Cancelled.");
    return;
  }
  await api("DELETE", `/rooms/${roomId}`);
  console.log("Room deleted.");
  return "left";
}

async function leaveRoom(roomId) {
  if (!(await confirm("Leave this room"))) return;
  await api("DELETE", `/rooms/${roomId}/participants/${me.id}`);
  console.log("You left the room.");
  return "left";
}

// ---------------------------------------------------------------------------------------
// Live view (WebSocket)
// ---------------------------------------------------------------------------------------
async function watch(roomId, room) {
  const { ticket } = await api("GET", "/auth/ws-ticket");
  const url = `${BASE.replace(/^http/, "ws")}/ws?roomId=${roomId}&ticket=${encodeURIComponent(ticket)}`;
  const names = new Map(room.participants.map((p) => [p.userId, p.displayName]));
  const online = new Set();
  let latest = room;
  let phase = room.session?.state;

  const status = () =>
    process.stdout.write(`\r\x1b[K${stateLine(latest)}   online: ${online.size}/${latest.participants.length}`);
  const note = (text) => {
    process.stdout.write(`\r\x1b[K${text}\n`);
    status();
  };
  const nameOf = (id) => names.get(id) ?? "Someone";

  const ws = new WebSocket(url);
  ws.on("open", () => console.log("Connected. Press Enter to stop watching.\n"));
  ws.on("error", (err) => process.stdout.write(`\n! Couldn't stay connected: ${err.message}\n`));
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    switch (message.type) {
      case "room:update":
        latest = message.room;
        for (const p of latest.participants) names.set(p.userId, p.displayName);
        if (latest.session && latest.session.state !== phase) {
          phase = latest.session.state;
          note(`Timer: now ${PHASE_NAMES[phase].toLowerCase()}`);
        } else {
          status();
        }
        break;
      case "presence:sync":
        online.clear();
        for (const id of message.onlineUserIds) online.add(id);
        break;
      case "presence:joined":
        online.add(message.userId);
        note(`${nameOf(message.userId)} is online`);
        break;
      case "presence:left":
        online.delete(message.userId);
        note(`${nameOf(message.userId)} went offline`);
        break;
      case "document:update": {
        const d = message.document;
        note(`Notes "${d.filename}": ${d.status.toLowerCase()}${d.failureReason ? ` — ${d.failureReason}` : ""}`);
        break;
      }
      case "quiz:ready":
        note("A new quiz is ready.");
        break;
      case "room:deleted":
        note("The host deleted this room.");
        break;
    }
  });

  const closed = new Promise((resolve) => ws.on("close", () => resolve("closed")));
  const enter = askCancelable("");
  const first = await Promise.race([enter.promise.then(() => "enter"), closed]);
  if (first === "closed") enter.cancel();
  ws.close();
  process.stdout.write("\n");
  if (first === "closed") console.log("The connection closed (you may have been removed, or the server stopped).");
}

// ---------------------------------------------------------------------------------------
async function main() {
  console.log(`SyncSpace terminal client   (server: ${BASE})`);
  try {
    await api("GET", "/health");
  } catch (err) {
    console.log(`! ${err.message}`);
    process.exit(1);
  }

  try {
    for (;;) {
      try {
        await (me ? homeMenu() : authMenu());
      } catch (err) {
        if (err instanceof Quit) break;
        console.log(`! ${err.message}`);
      }
    }
  } finally {
    // Don't leave a signed-in session behind on the server.
    if (cookie) await api("POST", "/auth/logout").catch(() => {});
  }
  console.log("Bye.");
  rl.close();
  process.exit(0);
}

main();
