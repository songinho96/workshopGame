const STORAGE_KEY = "okestro-workshop-session-id";

const state = {
  teamCount: 4,
  teams: [],
  currentStep: 1,
  workshopId: null,
  finalRankings: [],
  supabase: null,
  syncEnabled: false,
  syncStatus: "준비 중",
  storageMode: "브라우저 임시 저장",
  saveTimer: null,
  subscription: null,
  isRestoring: false,
};

const countOptions = [2, 3, 4, 5, 6, 7, 8];
const scoreFields = ["미션 1", "미션 2", "미션 3", "보너스"];

const panels = {
  1: document.getElementById("team-count-form"),
  2: document.getElementById("team-details-form"),
  3: document.getElementById("scoreboard-panel"),
  4: document.getElementById("final-results-panel"),
};

const progressSteps = Array.from(document.querySelectorAll(".progress-step"));
const countGrid = document.getElementById("count-grid");
const teamDetailsGrid = document.getElementById("team-details-grid");
const scoreEntryList = document.getElementById("score-entry-list");
const barChart = document.getElementById("bar-chart");
const leaderName = document.getElementById("leader-name");
const leaderScore = document.getElementById("leader-score");
const championName = document.getElementById("champion-name");
const championScore = document.getElementById("champion-score");
const championMotto = document.getElementById("champion-motto");
const rankingSummary = document.getElementById("ranking-summary");
const rankingList = document.getElementById("ranking-list");
const teamDetailTemplate = document.getElementById("team-detail-template");
const scoreCardTemplate = document.getElementById("score-card-template");

init();

async function init() {
  renderCountOptions();
  renderTeamDetailFields();
  attachEvents();
  clearFinalResults();
  updateStep(1);
  initializeSupabase();
  await restoreExistingSession();
}

function initializeSupabase() {
  const config = window.WORKSHOP_SUPABASE_CONFIG || {};
  const hasConfig = Boolean(config.url && config.anonKey);
  const hasLibrary = Boolean(window.supabase?.createClient);

  if (hasConfig && hasLibrary) {
    state.supabase = window.supabase.createClient(config.url, config.anonKey);
    state.syncEnabled = true;
    state.storageMode = "Supabase 실시간 저장";
    setSyncStatus("Supabase 연결됨");
  } else {
    state.storageMode = "브라우저 임시 저장";
    setSyncStatus("Supabase 설정 필요");
  }

  renderStorageInfo();
}

async function restoreExistingSession() {
  const savedWorkshopId = localStorage.getItem(STORAGE_KEY);
  if (!savedWorkshopId) {
    renderStorageInfo();
    return;
  }

  state.workshopId = savedWorkshopId;
  renderStorageInfo();

  if (!state.syncEnabled) {
    setSyncStatus("세션 코드만 저장됨");
    return;
  }

  setSyncStatus("저장된 세션 불러오는 중");
  const workshop = await fetchWorkshopById(savedWorkshopId);

  if (!workshop) {
    localStorage.removeItem(STORAGE_KEY);
    state.workshopId = null;
    setSyncStatus("저장된 세션을 찾지 못함");
    renderStorageInfo();
    return;
  }

  applyWorkshopData(workshop);
  subscribeToWorkshop(savedWorkshopId);
  setSyncStatus("저장된 세션 복원됨");
}

function attachEvents() {
  document
    .getElementById("team-count-form")
    .addEventListener("submit", handleTeamCountSubmit);

  document
    .getElementById("team-details-form")
    .addEventListener("submit", handleTeamDetailsSubmit);

  document
    .getElementById("back-to-count")
    .addEventListener("click", () => updateStep(1));

  document
    .getElementById("back-to-details")
    .addEventListener("click", () => updateStep(2));

  document
    .getElementById("restart-flow")
    .addEventListener("click", restartFlow);

  document
    .getElementById("show-final-results")
    .addEventListener("click", showFinalResults);

  document
    .getElementById("back-to-scoreboard")
    .addEventListener("click", () => updateStep(3));

  document
    .getElementById("restart-from-final")
    .addEventListener("click", restartFlow);

  document
    .getElementById("reset-scores")
    .addEventListener("click", resetScores);
}

function renderCountOptions() {
  countGrid.innerHTML = "";

  countOptions.forEach((count) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `count-option${count === state.teamCount ? " selected" : ""}`;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(count === state.teamCount));
    button.dataset.count = String(count);
    button.innerHTML = `<strong>${count}</strong><span>${count}개 팀</span>`;

    button.addEventListener("click", () => {
      state.teamCount = count;
      renderCountOptions();
      renderTeamDetailFields();
    });

    countGrid.appendChild(button);
  });
}

function renderTeamDetailFields() {
  const previousTeams = [...state.teams];
  teamDetailsGrid.innerHTML = "";

  state.teams = Array.from({ length: state.teamCount }, (_, index) => {
    const previous = previousTeams[index];
    return {
      id: index + 1,
      name: previous?.name || `팀 ${index + 1}`,
      motto: previous?.motto || "",
      scores: normalizeScores(previous?.scores || [0, 0, 0, 0]),
    };
  });

  state.teams.forEach((team, index) => {
    const fragment = teamDetailTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".team-card");
    const chip = fragment.querySelector(".team-chip");
    const title = fragment.querySelector("h3");
    const nameInput = fragment.querySelector('input[name="teamName"]');
    const mottoInput = fragment.querySelector('input[name="teamMotto"]');

    chip.textContent = index + 1;
    title.textContent = `${index + 1}번 팀`;
    nameInput.value = team.name;
    mottoInput.value = team.motto;
    card.dataset.teamIndex = String(index);
    teamDetailsGrid.appendChild(fragment);
  });
}

function handleTeamCountSubmit(event) {
  event.preventDefault();
  updateStep(2);
}

async function handleTeamDetailsSubmit(event) {
  event.preventDefault();

  const cards = Array.from(teamDetailsGrid.querySelectorAll(".team-card"));
  state.teams = cards.map((card, index) => {
    const nameValue = card.querySelector('input[name="teamName"]').value.trim();
    const mottoValue = card.querySelector('input[name="teamMotto"]').value.trim();
    const previousScores = state.teams[index]?.scores || [0, 0, 0, 0];

    return {
      id: index + 1,
      name: nameValue || `팀 ${index + 1}`,
      motto: mottoValue || "구호를 입력해 보세요",
      scores: normalizeScores(previousScores),
    };
  });

  renderScoreboard();
  updateStep(3);
  await ensureWorkshopExists();
  await persistWorkshopSnapshot("draft");
}

function renderScoreboard() {
  scoreEntryList.innerHTML = "";

  state.teams.forEach((team, teamIndex) => {
    const fragment = scoreCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".score-card");
    const teamName = fragment.querySelector(".score-team-name");
    const teamMotto = fragment.querySelector(".score-team-motto");
    const totalValue = fragment.querySelector(".score-total-value");
    const inputs = Array.from(fragment.querySelectorAll("input"));

    card.dataset.teamIndex = String(teamIndex);
    teamName.textContent = team.name;
    teamMotto.textContent = team.motto;
    totalValue.textContent = String(sumScores(team.scores));

    inputs.forEach((input, scoreIndex) => {
      input.value = team.scores[scoreIndex] ? String(team.scores[scoreIndex]) : "";
      input.placeholder = scoreFields[scoreIndex];
      input.addEventListener("input", (event) => {
        const rawValue = event.target.value;
        state.teams[teamIndex].scores[scoreIndex] = Number(rawValue) || 0;
        totalValue.textContent = String(sumScores(state.teams[teamIndex].scores));
        updateChart();
        scheduleRemoteSave("live");
      });
    });

    scoreEntryList.appendChild(fragment);
  });

  updateChart();
}

function updateChart() {
  const rankedTeams = getRankedTeams();
  const highestScore = rankedTeams[0]?.total || 0;

  barChart.innerHTML = "";

  if (!rankedTeams.length) {
    barChart.innerHTML = '<div class="empty-state">팀을 먼저 만들어 주세요.</div>';
    leaderName.textContent = "아직 없음";
    leaderScore.textContent = "점수를 입력하면 결과가 보여요";
    return;
  }

  rankedTeams.forEach((team, index) => {
    const row = document.createElement("div");
    const label = document.createElement("div");
    const track = document.createElement("div");
    const fill = document.createElement("div");
    const width = highestScore === 0 ? 0 : (team.total / highestScore) * 100;

    row.className = "bar-row";
    label.className = "bar-label";
    track.className = "bar-track";
    fill.className = "bar-fill";
    label.innerHTML = `<span>${index + 1}위 ${team.name}</span><strong>${team.total}점</strong>`;
    fill.style.width = `${width}%`;

    track.appendChild(fill);
    row.appendChild(label);
    row.appendChild(track);
    barChart.appendChild(row);
  });

  const leader = rankedTeams[0];
  if (leader.total === 0) {
    leaderName.textContent = leader.name;
    leaderScore.textContent = "아직 점수가 없어요. 첫 점수를 입력해 보세요.";
    return;
  }

  leaderName.textContent = leader.name;
  leaderScore.textContent = `${leader.total}점으로 선두입니다. "${leader.motto}"`;
}

function resetScores() {
  state.teams = state.teams.map((team) => ({
    ...team,
    scores: [0, 0, 0, 0],
  }));

  renderScoreboard();
  scheduleRemoteSave("live");
}

function restartFlow() {
  if (state.subscription) {
    state.supabase?.removeChannel(state.subscription);
    state.subscription = null;
  }

  state.teamCount = 4;
  state.teams = [];
  state.workshopId = null;
  state.finalRankings = [];
  localStorage.removeItem(STORAGE_KEY);
  renderCountOptions();
  renderTeamDetailFields();
  clearFinalResults();
  updateStep(1);
  renderStorageInfo();
  setSyncStatus(state.syncEnabled ? "새 세션 준비됨" : "Supabase 설정 필요");
}

function updateStep(step) {
  state.currentStep = step;

  Object.entries(panels).forEach(([panelStep, panel]) => {
    panel.classList.toggle("is-visible", Number(panelStep) === step);
  });

  progressSteps.forEach((stepElement, index) => {
    const stepNumber = index + 1;
    stepElement.classList.toggle("is-active", stepNumber === step);
    stepElement.classList.toggle("is-complete", stepNumber < step);
  });
}

function getRankedTeams() {
  return [...state.teams]
    .map((team) => ({ ...team, total: sumScores(team.scores) }))
    .sort((a, b) => b.total - a.total);
}

async function showFinalResults() {
  const rankedTeams = getRankedTeams();
  state.finalRankings = rankedTeams;
  renderFinalResults(rankedTeams);
  updateStep(4);
  await persistWorkshopSnapshot("final");
}

function renderFinalResults(rankedTeams) {
  rankingList.innerHTML = "";

  if (!rankedTeams.length) {
    clearFinalResults();
    return;
  }

  const champion = rankedTeams[0];
  championName.textContent = champion.name;
  championScore.textContent = `${champion.total}점`;
  championMotto.textContent =
    champion.total > 0
      ? `"${champion.motto}"`
      : "아직 점수가 없어요. 점수를 입력한 뒤 다시 발표해 보세요.";
  rankingSummary.textContent = `총 ${rankedTeams.length}개 팀`;

  rankedTeams.forEach((team, index) => {
    const item = document.createElement("article");
    item.className = `ranking-item${index === 0 ? " is-top" : ""}`;
    item.innerHTML = `
      <div class="ranking-rank">${index + 1}위</div>
      <div class="ranking-meta">
        <strong>${team.name}</strong>
        <p>${team.motto}</p>
      </div>
      <div class="ranking-points">
        <strong>${team.total}점</strong>
        <span>최종 점수</span>
      </div>
    `;
    rankingList.appendChild(item);
  });
}

function clearFinalResults() {
  championName.textContent = "아직 집계 전";
  championScore.textContent = "0점";
  championMotto.textContent = "점수를 모두 입력한 뒤 최종 결과를 발표해 보세요.";
  rankingSummary.textContent = "총 0개 팀";
  rankingList.innerHTML =
    '<div class="empty-state">최종 결과를 발표하면 전체 등수가 여기에 표시됩니다.</div>';
}

async function ensureWorkshopExists() {
  if (!state.syncEnabled || state.workshopId) {
    renderStorageInfo();
    return;
  }

  setSyncStatus("워크샵 세션 생성 중");

  const { data, error } = await state.supabase
    .from("workshops")
    .insert({
      session_name: "Okestro 플랫폼 개발본부 워크샵",
      team_count: state.teamCount,
      status: "draft",
      final_rankings: [],
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error(error);
    setSyncStatus("세션 생성 실패");
    return;
  }

  state.workshopId = data.id;
  localStorage.setItem(STORAGE_KEY, data.id);
  renderStorageInfo();
  subscribeToWorkshop(data.id);
  setSyncStatus("세션 생성 완료");
}

async function persistWorkshopSnapshot(status) {
  if (!state.syncEnabled) {
    renderStorageInfo();
    return;
  }

  await ensureWorkshopExists();
  if (!state.workshopId) {
    return;
  }

  setSyncStatus("Supabase에 저장 중");

  const rankedTeams = getRankedTeams();
  const finalRankings = status === "final" ? rankedTeams : [];
  const teamPayload = state.teams.map((team, index) => ({
    workshop_id: state.workshopId,
    team_order: index + 1,
    name: team.name,
    motto: team.motto,
    scores: normalizeScores(team.scores),
    total_score: sumScores(team.scores),
    updated_at: new Date().toISOString(),
  }));

  const { error: workshopError } = await state.supabase
    .from("workshops")
    .update({
      team_count: state.teamCount,
      status,
      final_rankings: finalRankings,
      updated_at: new Date().toISOString(),
    })
    .eq("id", state.workshopId);

  if (workshopError) {
    console.error(workshopError);
    setSyncStatus("워크샵 저장 실패");
    return;
  }

  const { error: teamError } = await state.supabase
    .from("workshop_teams")
    .upsert(teamPayload, { onConflict: "workshop_id,team_order" });

  if (teamError) {
    console.error(teamError);
    setSyncStatus("팀 점수 저장 실패");
    return;
  }

  state.finalRankings = finalRankings;
  setSyncStatus("Supabase 저장 완료");
}

function scheduleRemoteSave(status) {
  if (!state.syncEnabled || state.isRestoring) {
    return;
  }

  window.clearTimeout(state.saveTimer);
  setSyncStatus("변경 사항 대기 중");
  state.saveTimer = window.setTimeout(() => {
    persistWorkshopSnapshot(status);
  }, 500);
}

async function fetchWorkshopById(workshopId) {
  if (!state.syncEnabled) {
    return null;
  }

  const { data: workshop, error: workshopError } = await state.supabase
    .from("workshops")
    .select("*")
    .eq("id", workshopId)
    .single();

  if (workshopError || !workshop) {
    console.error(workshopError);
    return null;
  }

  const { data: teams, error: teamError } = await state.supabase
    .from("workshop_teams")
    .select("*")
    .eq("workshop_id", workshopId)
    .order("team_order", { ascending: true });

  if (teamError) {
    console.error(teamError);
    return null;
  }

  return { workshop, teams: teams || [] };
}

function applyWorkshopData(payload) {
  const { workshop, teams } = payload;
  const nextStep = state.currentStep === 4 && state.finalRankings.length ? 4 : 3;
  state.isRestoring = true;
  state.workshopId = workshop.id;
  state.teamCount = workshop.team_count || teams.length || 4;
  state.teams = teams.map((team, index) => ({
    id: index + 1,
    name: team.name,
    motto: team.motto,
    scores: normalizeScores(team.scores),
  }));
  state.finalRankings = Array.isArray(workshop.final_rankings) ? workshop.final_rankings : [];

  renderCountOptions();
  renderTeamDetailFields();
  renderScoreboard();
  renderStorageInfo();

  if (state.finalRankings.length) {
    renderFinalResults(state.finalRankings);
  } else {
    clearFinalResults();
  }

  updateStep(nextStep);
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
    .channel(`workshop-live-${workshopId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "workshops",
        filter: `id=eq.${workshopId}`,
      },
      async () => {
        await refreshFromRemote();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "workshop_teams",
        filter: `workshop_id=eq.${workshopId}`,
      },
      async () => {
        await refreshFromRemote();
      }
    )
    .subscribe((statusText) => {
      if (statusText === "SUBSCRIBED") {
        setSyncStatus("실시간 동기화 중");
      }
    });
}

async function refreshFromRemote() {
  if (!state.workshopId || !state.syncEnabled || state.isRestoring) {
    return;
  }

  const payload = await fetchWorkshopById(state.workshopId);
  if (!payload) {
    return;
  }

  applyWorkshopData(payload);
  setSyncStatus("최신 점수 반영됨");
}

function renderStorageInfo() {
  return;
}

function setSyncStatus(message) {
  state.syncStatus = message;
  renderStorageInfo();
}

function normalizeScores(scores) {
  if (Array.isArray(scores)) {
    return scoreFields.map((_, index) => Number(scores[index]) || 0);
  }

  if (typeof scores === "string") {
    try {
      const parsed = JSON.parse(scores);
      return normalizeScores(parsed);
    } catch (error) {
      return [0, 0, 0, 0];
    }
  }

  return [0, 0, 0, 0];
}

function sumScores(scores) {
  return normalizeScores(scores).reduce((total, score) => total + score, 0);
}
