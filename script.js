const STORAGE_KEY = "okestro-workshop-session-id";
const SCORE_TYPES = [
  { key: "mission1", label: "1번째 미션" },
  { key: "mission2", label: "2번째 미션" },
  { key: "mission3", label: "3번째 미션" },
  { key: "bonus", label: "보너스" },
];

const state = {
  workshopId: null,
  teams: [],
  scoreEvents: [],
  currentStep: "setup",
  supabase: null,
  syncEnabled: false,
  connectionState: "연결안됨",
  subscription: null,
  isRestoring: false,
  ceremonyOpen: false,
  celebrationOpen: false,
};

const progressSteps = [...document.querySelectorAll("[data-step-indicator]")];
const panels = {
  setup: document.getElementById("setup-panel"),
  score: document.getElementById("score-panel"),
  summary: document.getElementById("summary-panel"),
};

const connectionStatus = document.getElementById("connection-status");
const sessionCode = document.getElementById("session-code");
const teamCountInput = document.getElementById("team-count-input");
const buildTeamFormButton = document.getElementById("build-team-form");
const teamFormGrid = document.getElementById("team-form-grid");
const saveScoreboardButton = document.getElementById("save-scoreboard");
const teamSelect = document.getElementById("team-select");
const scoreTypeSelect = document.getElementById("score-type-select");
const scoreValueInput = document.getElementById("score-value-input");
const addScoreButton = document.getElementById("add-score-button");
const goSummaryButton = document.getElementById("go-summary-button");
const resetSessionButton = document.getElementById("reset-session-button");
const backToScoreButton = document.getElementById("back-to-score-button");
const finishSummaryButton = document.getElementById("finish-summary-button");
const eventFeed = document.getElementById("event-feed");
const summaryEventFeed = document.getElementById("summary-event-feed");
const rankingList = document.getElementById("ranking-list");
const totalTeamCount = document.getElementById("total-team-count");
const leaderName = document.getElementById("leader-name");
const leaderSummary = document.getElementById("leader-summary");
const ceremonyScreen = document.getElementById("ceremony-screen");
const ceremonyRankingList = document.getElementById("ceremony-ranking-list");
const ceremonyTopCount = document.getElementById("ceremony-top-count");
const winnerButtonGroup = document.getElementById("winner-button-group");
const closeCeremonyButton = document.getElementById("close-ceremony-button");
const celebrationOverlay = document.getElementById("celebration-overlay");
const celebrationTitle = document.getElementById("celebration-title");
const celebrationTeam = document.getElementById("celebration-team");
const celebrationCopy = document.getElementById("celebration-copy");
const closeCelebrationButton = document.getElementById("close-celebration-button");
const fireworksLayer = document.getElementById("fireworks-layer");
const teamFormTemplate = document.getElementById("team-form-template");

let celebrationAudioContext = null;
let celebrationSequenceTimer = null;

init();

async function init() {
  renderTeamForm();
  attachEvents();
  initializeSupabase();
  await restoreExistingSession();
  renderAll();
}

function attachEvents() {
  buildTeamFormButton?.addEventListener("click", renderTeamForm);
  saveScoreboardButton?.addEventListener("click", handleSaveScoreboard);
  addScoreButton?.addEventListener("click", handleAddScore);
  goSummaryButton?.addEventListener("click", () => updateStep("summary"));
  backToScoreButton?.addEventListener("click", () => updateStep("score"));
  finishSummaryButton?.addEventListener("click", openCeremonyMode);
  resetSessionButton?.addEventListener("click", resetSession);
  closeCeremonyButton?.addEventListener("click", closeCeremonyMode);
  closeCelebrationButton?.addEventListener("click", closeCelebration);
  celebrationOverlay?.addEventListener("click", (event) => {
    if (event.target === celebrationOverlay || event.target.classList.contains("celebration-backdrop")) {
      closeCelebration();
    }
  });
  document.addEventListener("keydown", handleGlobalKeydown);
}

function initializeSupabase() {
  const config = window.WORKSHOP_SUPABASE_CONFIG || {};
  const hasConfig = Boolean(config.url && config.anonKey);
  const hasLibrary = Boolean(window.supabase?.createClient);

  if (!hasConfig || !hasLibrary) {
    state.syncEnabled = false;
    state.connectionState = "연결안됨";
    return;
  }

  state.supabase = window.supabase.createClient(config.url, config.anonKey);
  state.syncEnabled = true;
  state.connectionState = "연결됨";
}

async function restoreExistingSession() {
  const savedWorkshopId = localStorage.getItem(STORAGE_KEY);

  if (!savedWorkshopId || !state.syncEnabled) {
    return;
  }

  state.workshopId = savedWorkshopId;
  const payload = await fetchWorkshopSnapshot(savedWorkshopId);

  if (!payload) {
    localStorage.removeItem(STORAGE_KEY);
    state.workshopId = null;
    state.connectionState = "연결안됨";
    return;
  }

  applyRemotePayload(payload);
  subscribeToWorkshop(savedWorkshopId);
}

function renderTeamForm() {
  const count = clampTeamCount(Number(teamCountInput?.value) || 4);
  const existingTeams = collectDraftTeams();
  teamFormGrid.innerHTML = "";

  Array.from({ length: count }, (_, index) => {
    const fragment = teamFormTemplate.content.cloneNode(true);
    const chip = fragment.querySelector(".team-chip");
    const title = fragment.querySelector("h3");
    const nameInput = fragment.querySelector(".team-name-input");
    const mottoInput = fragment.querySelector(".team-motto-input");
    const existing = existingTeams[index];

    chip.textContent = String(index + 1);
    title.textContent = `${index + 1}번 팀`;
    nameInput.value = existing?.name || "";
    mottoInput.value = existing?.motto || "";
    teamFormGrid.appendChild(fragment);
  });
}

function collectDraftTeams() {
  const cards = [...teamFormGrid.querySelectorAll(".team-card")];

  if (cards.length === 0) {
    return state.teams;
  }

  return cards.map((card, index) => ({
    id: index + 1,
    name: card.querySelector(".team-name-input")?.value.trim() || "",
    motto: card.querySelector(".team-motto-input")?.value.trim() || "",
  }));
}

async function handleSaveScoreboard() {
  const teams = collectDraftTeams().map((team, index) => ({
    id: index + 1,
    name: team.name || `${index + 1}팀`,
    motto: team.motto || "팀 구호를 입력해 주세요",
    scores: createEmptyScoreRecord(),
    totalScore: 0,
  }));

  if (teams.length < 2) {
    return;
  }

  state.teams = teams;
  state.scoreEvents = [];
  await ensureWorkshopExists();
  await persistWorkshopSnapshot();
  updateStep("score");
  renderAll();
}

async function handleAddScore() {
  if (!state.workshopId || state.teams.length === 0) {
    return;
  }

  const teamId = Number(teamSelect.value);
  const scoreType = scoreTypeSelect.value;
  const scoreValue = Number(scoreValueInput.value) || 0;
  const team = state.teams.find((item) => item.id === teamId);

  if (!team) {
    return;
  }

  team.scores[scoreType] += scoreValue;
  team.totalScore = sumTeamScore(team.scores);

  const event = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    teamId,
    teamName: formatTeamLabel(team),
    scoreType,
    scoreLabel: getScoreTypeLabel(scoreType),
    scoreValue,
    createdAt: new Date().toISOString(),
  };

  state.scoreEvents.unshift(event);
  scoreValueInput.value = "0";

  await persistWorkshopSnapshot();
  renderAll();
}

async function handleDeleteScoreEvent(eventId) {
  const targetEvent = state.scoreEvents.find((event) => event.id === eventId);

  if (!targetEvent) {
    return;
  }

  const team = state.teams.find((item) => item.id === targetEvent.teamId);

  if (team) {
    team.scores[targetEvent.scoreType] = Math.max(
      0,
      (Number(team.scores[targetEvent.scoreType]) || 0) - targetEvent.scoreValue
    );
    team.totalScore = sumTeamScore(team.scores);
  }

  state.scoreEvents = state.scoreEvents.filter((event) => event.id !== eventId);
  await persistWorkshopSnapshot();
  renderAll();
}

async function ensureWorkshopExists() {
  if (!state.syncEnabled || state.workshopId) {
    return;
  }

  const { data, error } = await state.supabase
    .from("workshops")
    .insert({
      session_name: "Okestro Workshop Scoreboard",
      team_count: state.teams.length,
      status: "live",
      final_rankings: [],
    })
    .select("id")
    .single();

  if (error || !data) {
    state.connectionState = "연결안됨";
    return;
  }

  state.workshopId = data.id;
  localStorage.setItem(STORAGE_KEY, data.id);
  subscribeToWorkshop(data.id);
}

async function persistWorkshopSnapshot() {
  if (!state.syncEnabled || !state.workshopId) {
    return;
  }

  const rankedTeams = getRankedTeams();
  const teamPayload = state.teams.map((team, index) => ({
    workshop_id: state.workshopId,
    team_order: index + 1,
    name: team.name,
    motto: team.motto,
    scores: team.scores,
    total_score: team.totalScore,
    updated_at: new Date().toISOString(),
  }));

  const eventPayload = state.scoreEvents.map((event) => ({
    id: event.id,
    workshop_id: state.workshopId,
    team_order: event.teamId,
    score_type: event.scoreType,
    score_label: event.scoreLabel,
    score_value: event.scoreValue,
    created_at: event.createdAt,
  }));

  const { error: workshopError } = await state.supabase
    .from("workshops")
    .update({
      team_count: state.teams.length,
      status: "live",
      final_rankings: rankedTeams,
      updated_at: new Date().toISOString(),
    })
    .eq("id", state.workshopId);

  if (workshopError) {
    state.connectionState = "연결안됨";
    return;
  }

  const { error: teamError } = await state.supabase
    .from("workshop_teams")
    .upsert(teamPayload, { onConflict: "workshop_id,team_order" });

  if (teamError) {
    state.connectionState = "연결안됨";
    return;
  }

  const { error: resetEventsError } = await state.supabase
    .from("workshop_score_events")
    .delete()
    .eq("workshop_id", state.workshopId);

  if (resetEventsError) {
    state.connectionState = "연결안됨";
    return;
  }

  if (eventPayload.length > 0) {
    const { error: eventError } = await state.supabase
      .from("workshop_score_events")
      .insert(eventPayload);

    if (eventError) {
      state.connectionState = "연결안됨";
      return;
    }
  }

  state.connectionState = "연결됨";
}

async function fetchWorkshopSnapshot(workshopId) {
  if (!state.syncEnabled) {
    return null;
  }

  const { data: workshop, error: workshopError } = await state.supabase
    .from("workshops")
    .select("*")
    .eq("id", workshopId)
    .single();

  if (workshopError || !workshop) {
    return null;
  }

  const { data: teams, error: teamError } = await state.supabase
    .from("workshop_teams")
    .select("*")
    .eq("workshop_id", workshopId)
    .order("team_order", { ascending: true });

  if (teamError) {
    return null;
  }

  const { data: events, error: eventError } = await state.supabase
    .from("workshop_score_events")
    .select("*")
    .eq("workshop_id", workshopId)
    .order("created_at", { ascending: false });

  if (eventError) {
    return null;
  }

  return {
    workshop,
    teams: teams || [],
    events: events || [],
  };
}

function applyRemotePayload(payload) {
  state.isRestoring = true;
  state.teams = payload.teams.map((team, index) => ({
    id: index + 1,
    name: team.name,
    motto: team.motto,
    scores: normalizeScoreRecord(team.scores),
    totalScore: Number(team.total_score) || sumTeamScore(team.scores),
  }));
  state.scoreEvents = payload.events.map((event) => ({
    id: event.id,
    teamId: event.team_order,
    teamName:
      formatTeamLabel(state.teams.find((team) => team.id === event.team_order)) ||
      `${event.team_order}팀`,
    scoreType: event.score_type,
    scoreLabel: event.score_label,
    scoreValue: Number(event.score_value) || 0,
    createdAt: event.created_at,
  }));
  state.currentStep = state.teams.length > 0 ? "score" : "setup";
  state.connectionState = "연결됨";
  state.isRestoring = false;
}

function subscribeToWorkshop(workshopId) {
  if (!state.syncEnabled || !workshopId) {
    return;
  }

  if (state.subscription) {
    state.supabase.removeChannel(state.subscription);
  }

  state.subscription = state.supabase
    .channel(`workshop-scoreboard-${workshopId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "workshops", filter: `id=eq.${workshopId}` },
      refreshFromRemote
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "workshop_teams", filter: `workshop_id=eq.${workshopId}` },
      refreshFromRemote
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "workshop_score_events", filter: `workshop_id=eq.${workshopId}` },
      refreshFromRemote
    )
    .subscribe();
}

async function refreshFromRemote() {
  if (!state.workshopId || state.isRestoring) {
    return;
  }

  const payload = await fetchWorkshopSnapshot(state.workshopId);

  if (!payload) {
    state.connectionState = "연결안됨";
    renderConnectionInfo();
    return;
  }

  applyRemotePayload(payload);
  renderAll();
}

async function resetSession() {
  if (state.subscription) {
    state.supabase?.removeChannel(state.subscription);
    state.subscription = null;
  }

  if (state.syncEnabled && state.workshopId) {
    await state.supabase.from("workshops").delete().eq("id", state.workshopId);
  }

  localStorage.removeItem(STORAGE_KEY);
  state.workshopId = null;
  state.teams = [];
  state.scoreEvents = [];
  state.currentStep = "setup";
  state.ceremonyOpen = false;
  state.celebrationOpen = false;
  renderTeamForm();
  renderAll();
}

function renderAll() {
  renderConnectionInfo();
  renderStep();
  renderTeamSelect();
  renderScoreFeeds();
  renderSummary();
  renderCeremony();
}

function renderConnectionInfo() {
  connectionStatus.textContent = state.connectionState;
  sessionCode.textContent = state.workshopId ? state.workshopId.slice(0, 8) : "없음";
}

function renderStep() {
  Object.entries(panels).forEach(([key, panel]) => {
    panel.classList.toggle("is-visible", key === state.currentStep);
  });

  progressSteps.forEach((step) => {
    const key = step.dataset.stepIndicator;
    step.classList.toggle("is-active", key === state.currentStep);
    step.classList.toggle("is-complete", getStepOrder(key) < getStepOrder(state.currentStep));
  });
}

function renderTeamSelect() {
  teamSelect.innerHTML = "";

  state.teams.forEach((team) => {
    const option = document.createElement("option");
    option.value = String(team.id);
    option.textContent = `${formatTeamLabel(team)} (${team.totalScore}점)`;
    teamSelect.appendChild(option);
  });

  addScoreButton.disabled = state.teams.length === 0;
  goSummaryButton.disabled = state.teams.length === 0;
  resetSessionButton.disabled = !state.workshopId;
}

function renderScoreFeeds() {
  renderEventFeed(eventFeed);
  renderEventFeed(summaryEventFeed);
}

function renderEventFeed(container) {
  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (state.scoreEvents.length === 0) {
    container.innerHTML = '<div class="empty-state">아직 점수 변경 내역이 없습니다.</div>';
    return;
  }

  state.scoreEvents.forEach((event) => {
    const item = document.createElement("article");
    item.className = "event-item";
    item.innerHTML = `
      <div class="event-row">
        <strong>${event.teamName} · ${event.scoreLabel} · +${event.scoreValue}점</strong>
        <button class="event-delete-button" type="button">삭제</button>
      </div>
      <div class="event-meta">${formatEventTime(event.createdAt)}</div>
    `;
    item
      .querySelector(".event-delete-button")
      ?.addEventListener("click", () => handleDeleteScoreEvent(event.id));
    container.appendChild(item);
  });
}

function renderSummary() {
  const rankedTeams = getRankedTeams();
  rankingList.innerHTML = "";
  totalTeamCount.textContent = `총 ${rankedTeams.length}팀`;

  if (rankedTeams.length === 0) {
    leaderName.textContent = "없음";
    leaderSummary.textContent = "점수를 입력하면 결과가 여기에 표시됩니다.";
    rankingList.innerHTML = '<div class="empty-state">아직 저장된 팀 결과가 없습니다.</div>';
    return;
  }

  const leader = rankedTeams[0];
  leaderName.textContent = formatTeamLabel(leader);
  leaderSummary.textContent = `${leader.totalScore}점으로 현재 선두입니다. "${leader.motto}"`;

  rankedTeams.forEach((team, index) => {
    const item = document.createElement("article");
    item.className = "ranking-item";
    item.innerHTML = `
      <div class="ranking-rank">${index + 1}</div>
      <div>
        <strong>${formatTeamLabel(team)}</strong>
        <div class="ranking-meta">${team.motto}</div>
      </div>
      <div class="ranking-score">${team.totalScore}점</div>
    `;
    rankingList.appendChild(item);
  });
}

function renderCeremony() {
  if (!ceremonyScreen || !ceremonyRankingList || !winnerButtonGroup) {
    return;
  }

  const rankedTeams = getRankedTeams().slice(0, 8);

  ceremonyScreen.classList.toggle("is-visible", state.ceremonyOpen);
  ceremonyScreen.setAttribute("aria-hidden", state.ceremonyOpen ? "false" : "true");
  celebrationOverlay?.classList.toggle("is-visible", state.celebrationOpen);
  celebrationOverlay?.setAttribute("aria-hidden", state.celebrationOpen ? "false" : "true");

  ceremonyRankingList.innerHTML = "";
  winnerButtonGroup.innerHTML = "";
  ceremonyTopCount.textContent = `TOP ${Math.min(3, rankedTeams.length)}`;

  if (rankedTeams.length === 0) {
    ceremonyRankingList.innerHTML = '<div class="empty-state">아직 시상할 점수 결과가 없습니다.</div>';
    winnerButtonGroup.innerHTML = '<div class="empty-state">먼저 점수를 입력한 뒤 완료를 눌러주세요.</div>';
    return;
  }

  rankedTeams.forEach((team, index) => {
    const item = document.createElement("article");
    item.className = `ceremony-ranking-item place-${index + 1}`;
    item.innerHTML = `
      <div class="ceremony-rank-badge">${index + 1}등</div>
      <div class="ceremony-rank-body">
        <strong>${formatTeamLabel(team)}</strong>
        <span>${team.motto}</span>
      </div>
      <div class="ceremony-rank-score">${team.totalScore}점</div>
    `;
    ceremonyRankingList.appendChild(item);
  });

  rankedTeams.slice(0, 3).forEach((team, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `winner-launch-button place-${index + 1}`;
    button.textContent = `${index + 1}등 축하`;
    button.addEventListener("click", () => openCelebration(index + 1, team));
    winnerButtonGroup.appendChild(button);
  });
}

function updateStep(step) {
  state.currentStep = step;
  renderStep();
}

function getRankedTeams() {
  return [...state.teams].sort((a, b) => b.totalScore - a.totalScore);
}

function createEmptyScoreRecord() {
  return {
    mission1: 0,
    mission2: 0,
    mission3: 0,
    bonus: 0,
  };
}

function normalizeScoreRecord(scores) {
  const base = createEmptyScoreRecord();

  if (!scores || typeof scores !== "object") {
    return base;
  }

  SCORE_TYPES.forEach((type) => {
    base[type.key] = Number(scores[type.key]) || 0;
  });

  return base;
}

function sumTeamScore(scores) {
  return SCORE_TYPES.reduce((total, type) => total + (Number(scores[type.key]) || 0), 0);
}

function clampTeamCount(value) {
  return Math.min(12, Math.max(2, value || 4));
}

function getScoreTypeLabel(scoreType) {
  return SCORE_TYPES.find((type) => type.key === scoreType)?.label || scoreType;
}

function getStepOrder(step) {
  return ["setup", "score", "summary"].indexOf(step);
}

function formatEventTime(isoString) {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ko-KR");
}

function formatTeamLabel(team) {
  if (!team) {
    return "";
  }

  const displayName = team.name || `${team.id}팀`;
  return `${team.id}팀: ${displayName}`;
}

async function openCeremonyMode() {
  state.ceremonyOpen = true;
  state.celebrationOpen = false;
  renderCeremony();
  await requestFullscreenView();
}

function closeCeremonyMode() {
  state.ceremonyOpen = false;
  state.celebrationOpen = false;
  stopCelebrationAudio();
  clearFireworks();
  celebrationOverlay.classList.remove("place-1", "place-2", "place-3");
  renderCeremony();
  exitFullscreenView();
}

function openCelebration(place, team) {
  const configs = {
    1: {
      title: "1등!!! 압도적 우승!!!",
      copy: "오늘의 레전드 팀입니다. 이건 진짜 난리나게 축하해야 합니다. 가장 큰 함성과 박수로 무대를 뒤집어주세요.",
    },
    2: {
      title: "2등!!! 엄청난 저력!!!",
      copy: "끝까지 몰아붙인 대단한 팀입니다. 아쉽지만 정말 뜨거운 박수를 받을 자격이 충분합니다.",
    },
    3: {
      title: "3등!!! 멋진 마무리!!!",
      copy: "유쾌한 에너지로 분위기를 살린 팀입니다. 신나는 박수와 환호로 함께 축하해주세요.",
    },
  };

  if (!team) {
    return;
  }

  state.celebrationOpen = true;
  celebrationOverlay.classList.remove("place-1", "place-2", "place-3");
  celebrationOverlay.classList.add(`place-${place}`);
  celebrationTitle.textContent = configs[place]?.title || `${place}등 축하합니다`;
  celebrationTeam.textContent = `${formatTeamLabel(team)} · ${team.totalScore}점`;
  celebrationCopy.textContent = configs[place]?.copy || "정말 멋진 결과를 만든 팀입니다.";
  launchCelebrationEffects(place);
  renderCeremony();
}

function closeCelebration() {
  state.celebrationOpen = false;
  celebrationOverlay.classList.remove("place-1", "place-2", "place-3");
  stopCelebrationAudio();
  clearFireworks();
  renderCeremony();
}

async function requestFullscreenView() {
  const target = document.documentElement;

  if (!document.fullscreenElement && target?.requestFullscreen) {
    try {
      await target.requestFullscreen();
    } catch (error) {
      return;
    }
  }
}

function exitFullscreenView() {
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape" && state.celebrationOpen) {
    closeCelebration();
    return;
  }

  if (event.key === "Escape" && state.ceremonyOpen) {
    closeCeremonyMode();
  }
}

function launchCelebrationEffects(place) {
  stopCelebrationAudio();
  clearFireworks();
  startFireworksShow(place);
  playCelebrationTheme(place);
}

function startFireworksShow(place) {
  if (!fireworksLayer) {
    return;
  }

  const burstMap = {
    1: [
      { left: "10%", top: "18%", delay: 0, size: "xl" },
      { left: "50%", top: "12%", delay: 120, size: "xl" },
      { left: "88%", top: "18%", delay: 220, size: "xl" },
      { left: "20%", top: "38%", delay: 420, size: "lg" },
      { left: "50%", top: "34%", delay: 520, size: "xl" },
      { left: "80%", top: "38%", delay: 640, size: "lg" },
      { left: "14%", top: "64%", delay: 860, size: "lg" },
      { left: "50%", top: "58%", delay: 980, size: "xl" },
      { left: "86%", top: "64%", delay: 1100, size: "lg" },
    ],
    2: [
      { left: "18%", top: "24%", delay: 0, size: "md" },
      { left: "78%", top: "24%", delay: 180, size: "md" },
      { left: "50%", top: "20%", delay: 360, size: "lg" },
      { left: "26%", top: "58%", delay: 620, size: "md" },
      { left: "74%", top: "58%", delay: 820, size: "md" },
    ],
    3: [
      { left: "28%", top: "28%", delay: 0, size: "sm" },
      { left: "72%", top: "30%", delay: 220, size: "sm" },
      { left: "50%", top: "52%", delay: 520, size: "sm" },
    ],
  };
  const bursts = burstMap[place] || burstMap[3];

  bursts.forEach((burst, index) => {
    window.setTimeout(() => {
      createFireworkBurst(burst.left, burst.top, index, burst.size);
    }, burst.delay);
  });
}

function createFireworkBurst(left, top, burstIndex, size = "md") {
  if (!fireworksLayer) {
    return;
  }

  const palette = [
    ["#fff7b1", "#ffcc33"],
    ["#ffd3f0", "#ff5fa2"],
    ["#b7f5ff", "#38bdf8"],
    ["#ffe0c1", "#fb923c"],
  ];
  const colors = palette[burstIndex % palette.length];
  const fragment = document.createDocumentFragment();
  const sparkCounts = { sm: 12, md: 18, lg: 24, xl: 34 };
  const baseDistances = { sm: 78, md: 118, lg: 168, xl: 248 };
  const sparkCount = sparkCounts[size] || sparkCounts.md;
  const baseDistance = baseDistances[size] || baseDistances.md;

  for (let index = 0; index < sparkCount; index += 1) {
    const spark = document.createElement("span");
    const angle = (Math.PI * 2 * index) / sparkCount;
    const distance = baseDistance + (index % 4) * Math.max(16, Math.round(baseDistance * 0.14));

    spark.className = "firework-spark";
    spark.dataset.size = size;
    spark.style.left = left;
    spark.style.top = top;
    spark.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    spark.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    spark.style.setProperty("--spark-color", colors[index % colors.length]);
    spark.style.animationDelay = `${index * 18}ms`;
    fragment.appendChild(spark);
  }

  fireworksLayer.appendChild(fragment);
  window.setTimeout(() => {
    clearFireworks();
  }, 2600);
}

function clearFireworks() {
  if (fireworksLayer) {
    fireworksLayer.innerHTML = "";
  }
}

function playCelebrationTheme(place) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  if (!celebrationAudioContext) {
    celebrationAudioContext = new AudioContextClass();
  }

  if (celebrationAudioContext.state === "suspended") {
    celebrationAudioContext.resume().catch(() => {});
  }

  const melodies = {
    1: [523.25, 659.25, 783.99, 1046.5, 783.99, 1174.66, 1318.51],
    2: [493.88, 587.33, 659.25, 783.99, 659.25, 880],
    3: [392, 493.88, 587.33, 659.25, 587.33],
  };
  const durations = {
    1: 0.26,
    2: 0.28,
    3: 0.3,
  };

  const notes = melodies[place] || melodies[3];
  const noteDuration = durations[place] || 0.3;
  let index = 0;

  celebrationSequenceTimer = window.setInterval(() => {
    const now = celebrationAudioContext.currentTime;
    playSynthNote(notes[index % notes.length], now, noteDuration, place === 1 ? 0.15 : 0.1);

    if (place === 1 && index % 2 === 0) {
      playSynthNote(notes[(index + 2) % notes.length] / 2, now, noteDuration * 1.1, 0.08);
    }

    index += 1;

    if (index >= notes.length) {
      stopCelebrationAudio(false);
    }
  }, noteDuration * 1000);
}

function playSynthNote(frequency, startTime, duration, gainValue) {
  if (!celebrationAudioContext) {
    return;
  }

  const oscillator = celebrationAudioContext.createOscillator();
  const gainNode = celebrationAudioContext.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.exponentialRampToValueAtTime(gainValue, startTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(celebrationAudioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.04);
}

function stopCelebrationAudio(closeContext = false) {
  if (celebrationSequenceTimer) {
    window.clearInterval(celebrationSequenceTimer);
    celebrationSequenceTimer = null;
  }

  if (closeContext && celebrationAudioContext) {
    celebrationAudioContext.close().catch(() => {});
    celebrationAudioContext = null;
  }
}
