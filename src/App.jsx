import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "okestro-workshop-session-id";
const SCORE_TYPES = [
  { key: "mission1", label: "1번째 미션" },
  { key: "mission2", label: "2번째 미션" },
  { key: "mission3", label: "3번째 미션" },
  { key: "bonus", label: "보너스" },
];

const STEP_ORDER = ["setup", "score", "summary"];

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
  return SCORE_TYPES.reduce((total, type) => total + (Number(scores?.[type.key]) || 0), 0);
}

function clampTeamCount(value) {
  return Math.min(12, Math.max(2, value || 4));
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

function getScoreTypeLabel(scoreType) {
  return SCORE_TYPES.find((type) => type.key === scoreType)?.label || scoreType;
}

function buildDraftTeams(count, existingDraftTeams = []) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: existingDraftTeams[index]?.name || "",
    motto: existingDraftTeams[index]?.motto || "",
  }));
}

function generateSessionCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

export default function App() {
  const supabaseRef = useRef(null);
  const subscriptionRef = useRef(null);
  const restoringRef = useRef(false);

  const [workshopId, setWorkshopId] = useState(null);
  const [sessionCodeValue, setSessionCodeValue] = useState("");
  const [teams, setTeams] = useState([]);
  const [scoreEvents, setScoreEvents] = useState([]);
  const [currentStep, setCurrentStep] = useState("setup");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [connectionState, setConnectionState] = useState("확인 중");
  const [teamCount, setTeamCount] = useState(4);
  const [draftTeams, setDraftTeams] = useState(() => buildDraftTeams(4));
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedScoreType, setSelectedScoreType] = useState("mission1");
  const [scoreValue, setScoreValue] = useState(0);
  const [ceremonyOpen, setCeremonyOpen] = useState(false);
  const [celebration, setCelebration] = useState({ open: false, place: null, team: null });
  const [joinCodeInput, setJoinCodeInput] = useState("");

  const rankedTeams = useMemo(() => [...teams].sort((a, b) => b.totalScore - a.totalScore), [teams]);
  const leader = rankedTeams[0] || null;

  useEffect(() => {
    const config = window.WORKSHOP_SUPABASE_CONFIG || {};
    if (config.url && config.anonKey) {
      supabaseRef.current = createClient(config.url, config.anonKey);
      setSyncEnabled(true);
      setConnectionState("연결됨");
    } else {
      setConnectionState("연결안됨");
    }
  }, []);

  useEffect(() => {
    if (!syncEnabled || !supabaseRef.current) {
      return;
    }

    let cancelled = false;

    async function restoreSession() {
      const savedWorkshopId = localStorage.getItem(STORAGE_KEY);
      if (!savedWorkshopId) {
        return;
      }

      const payload = await fetchWorkshopSnapshot(savedWorkshopId);
      if (cancelled) {
        return;
      }

      if (!payload) {
        localStorage.removeItem(STORAGE_KEY);
        setWorkshopId(null);
        setSessionCodeValue("");
        setConnectionState("연결안됨");
        return;
      }

      setWorkshopId(savedWorkshopId);
      applyRemotePayload(payload);
      subscribeToWorkshop(savedWorkshopId);
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, [syncEnabled]);

  useEffect(() => {
    if (!selectedTeamId && teams.length > 0) {
      setSelectedTeamId(String(teams[0].id));
    }
  }, [teams, selectedTeamId]);

  useEffect(() => {
    return () => {
      if (subscriptionRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(subscriptionRef.current);
      }
    };
  }, []);

  async function fetchWorkshopSnapshot(targetWorkshopId) {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return null;
    }

    const { data: workshop, error: workshopError } = await supabase
      .from("workshops")
      .select("*")
      .eq("id", targetWorkshopId)
      .single();

    if (workshopError || !workshop) {
      return null;
    }

    const { data: remoteTeams, error: teamError } = await supabase
      .from("workshop_teams")
      .select("*")
      .eq("workshop_id", targetWorkshopId)
      .order("team_order", { ascending: true });

    if (teamError) {
      return null;
    }

    const { data: events, error: eventError } = await supabase
      .from("workshop_score_events")
      .select("*")
      .eq("workshop_id", targetWorkshopId)
      .order("created_at", { ascending: false });

    if (eventError) {
      return null;
    }

    return {
      workshop,
      teams: remoteTeams || [],
      events: events || [],
    };
  }

async function fetchWorkshopByCode(code) {
  const supabase = supabaseRef.current;
  if (!supabase) {
    return null;
  }

    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
      return null;
    }

  const { data: workshop, error } = await supabase
    .from("workshops")
    .select("id")
    .eq("session_code", normalizedCode)
    .maybeSingle();

  if (!error && workshop?.id) {
    return fetchWorkshopSnapshot(workshop.id);
  }

  // Backward compatibility for older schemas that do not yet have session_code.
  const { data: fallbackWorkshops, error: fallbackError } = await supabase
    .from("workshops")
    .select("id, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (fallbackError || !fallbackWorkshops?.length) {
    return null;
  }

  const matchedWorkshop = fallbackWorkshops.find(
    (item) => upperSessionCode(item.id) === normalizedCode
  );

  if (!matchedWorkshop) {
    return null;
  }

  return fetchWorkshopSnapshot(matchedWorkshop.id);
}

  function applyRemotePayload(payload) {
    restoringRef.current = true;

    const remoteTeams = payload.teams.map((team, index) => ({
      id: index + 1,
      name: team.name,
      motto: team.motto,
      scores: normalizeScoreRecord(team.scores),
      totalScore: Number(team.total_score) || sumTeamScore(team.scores),
    }));

    const remoteEvents = payload.events.map((event) => ({
      id: event.id,
      teamId: event.team_order,
      teamName:
        formatTeamLabel(remoteTeams.find((team) => team.id === event.team_order)) ||
        `${event.team_order}팀`,
      scoreType: event.score_type,
      scoreLabel: event.score_label,
      scoreValue: Number(event.score_value) || 0,
      createdAt: event.created_at,
    }));

    setWorkshopId(payload.workshop.id);
    setSessionCodeValue(payload.workshop.session_code || upperSessionCode(payload.workshop.id));
    setTeams(remoteTeams);
    setScoreEvents(remoteEvents);
    setTeamCount(remoteTeams.length || 4);
    setDraftTeams(
      buildDraftTeams(
        remoteTeams.length || 4,
        remoteTeams.map((team) => ({ name: team.name, motto: team.motto }))
      )
    );
    setCurrentStep(remoteTeams.length > 0 ? "score" : "setup");
    setConnectionState("연결됨");

    window.setTimeout(() => {
      restoringRef.current = false;
    }, 0);
  }

  function subscribeToWorkshop(targetWorkshopId) {
    const supabase = supabaseRef.current;
    if (!supabase || !targetWorkshopId) {
      return;
    }

    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
    }

    subscriptionRef.current = supabase
      .channel(`workshop-scoreboard-${targetWorkshopId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workshops", filter: `id=eq.${targetWorkshopId}` },
        refreshFromRemote
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workshop_teams", filter: `workshop_id=eq.${targetWorkshopId}` },
        refreshFromRemote
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workshop_score_events",
          filter: `workshop_id=eq.${targetWorkshopId}`,
        },
        refreshFromRemote
      )
      .subscribe();
  }

  async function refreshFromRemote() {
    if (!workshopId || restoringRef.current) {
      return;
    }

    const payload = await fetchWorkshopSnapshot(workshopId);
    if (!payload) {
      setConnectionState("연결안됨");
      return;
    }

    applyRemotePayload(payload);
  }

  async function ensureWorkshopExists(nextTeams) {
    const supabase = supabaseRef.current;

    if (!syncEnabled || !supabase) {
      return workshopId;
    }

    if (workshopId) {
      return workshopId;
    }

    const sessionCode = generateSessionCode();
    let data = null;
    let error = null;

    ({ data, error } = await supabase
      .from("workshops")
      .insert({
        session_code: sessionCode,
        session_name: "Okestro Workshop Scoreboard React",
        team_count: nextTeams.length,
        status: "live",
        final_rankings: [],
      })
      .select("id, session_code")
      .single());

    if (error) {
      ({ data, error } = await supabase
        .from("workshops")
        .insert({
          session_name: "Okestro Workshop Scoreboard React",
          team_count: nextTeams.length,
          status: "live",
          final_rankings: [],
        })
        .select("id")
        .single());
    }

    if (error || !data) {
      setConnectionState("연결안됨");
      return null;
    }

    localStorage.setItem(STORAGE_KEY, data.id);
    setWorkshopId(data.id);
    setSessionCodeValue(data.session_code || upperSessionCode(data.id) || sessionCode);
    subscribeToWorkshop(data.id);
    return data.id;
  }

  async function persistWorkshopSnapshot(nextTeams, nextEvents) {
    const supabase = supabaseRef.current;
    if (!syncEnabled || !supabase) {
      return;
    }

    const currentWorkshopId = await ensureWorkshopExists(nextTeams);
    if (!currentWorkshopId) {
      return;
    }

    const orderedTeams = nextTeams.map((team, index) => ({
      workshop_id: currentWorkshopId,
      team_order: index + 1,
      name: team.name,
      motto: team.motto,
      scores: team.scores,
      total_score: team.totalScore,
      updated_at: new Date().toISOString(),
    }));

    const eventPayload = nextEvents.map((event) => ({
      id: event.id,
      workshop_id: currentWorkshopId,
      team_order: event.teamId,
      score_type: event.scoreType,
      score_label: event.scoreLabel,
      score_value: event.scoreValue,
      created_at: event.createdAt,
    }));

    const { error: workshopError } = await supabase
      .from("workshops")
      .update({
        team_count: nextTeams.length,
        status: "live",
        final_rankings: [...nextTeams].sort((a, b) => b.totalScore - a.totalScore),
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentWorkshopId);

    if (workshopError) {
      setConnectionState("연결안됨");
      return;
    }

    const { error: teamError } = await supabase
      .from("workshop_teams")
      .upsert(orderedTeams, { onConflict: "workshop_id,team_order" });

    if (teamError) {
      setConnectionState("연결안됨");
      return;
    }

    const { error: deleteEventsError } = await supabase
      .from("workshop_score_events")
      .delete()
      .eq("workshop_id", currentWorkshopId);

    if (deleteEventsError) {
      setConnectionState("연결안됨");
      return;
    }

    if (eventPayload.length > 0) {
      const { error: eventError } = await supabase.from("workshop_score_events").insert(eventPayload);
      if (eventError) {
        setConnectionState("연결안됨");
        return;
      }
    }

    setConnectionState("연결됨");
  }

  function handleBuildTeamForm() {
    const nextCount = clampTeamCount(Number(teamCount));
    setTeamCount(nextCount);
    setDraftTeams((current) => buildDraftTeams(nextCount, current));
  }

  async function handleSaveScoreboard() {
    const nextTeams = draftTeams.map((team, index) => ({
      id: index + 1,
      name: team.name || `${index + 1}팀`,
      motto: team.motto || "팀 구호를 입력해 주세요",
      scores: createEmptyScoreRecord(),
      totalScore: 0,
    }));

    if (nextTeams.length < 2) {
      return;
    }

    setTeams(nextTeams);
    setScoreEvents([]);
    setCurrentStep("score");
    await persistWorkshopSnapshot(nextTeams, []);
  }

  async function handleAddScore() {
    const teamId = Number(selectedTeamId);
    const value = Number(scoreValue) || 0;
    const targetTeam = teams.find((team) => team.id === teamId);

    if (!targetTeam) {
      return;
    }

    const nextTeams = teams.map((team) => {
      if (team.id !== teamId) {
        return team;
      }

      const nextScores = {
        ...team.scores,
        [selectedScoreType]: (Number(team.scores[selectedScoreType]) || 0) + value,
      };

      return {
        ...team,
        scores: nextScores,
        totalScore: sumTeamScore(nextScores),
      };
    });

    const updatedTeam = nextTeams.find((team) => team.id === teamId);
    const nextEvent = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      teamId,
      teamName: formatTeamLabel(updatedTeam),
      scoreType: selectedScoreType,
      scoreLabel: getScoreTypeLabel(selectedScoreType),
      scoreValue: value,
      createdAt: new Date().toISOString(),
    };

    const nextEvents = [nextEvent, ...scoreEvents];
    setTeams(nextTeams);
    setScoreEvents(nextEvents);
    setScoreValue(0);
    await persistWorkshopSnapshot(nextTeams, nextEvents);
  }

  async function handleDeleteScoreEvent(eventId) {
    const targetEvent = scoreEvents.find((event) => event.id === eventId);
    if (!targetEvent) {
      return;
    }

    const nextTeams = teams.map((team) => {
      if (team.id !== targetEvent.teamId) {
        return team;
      }

      const nextScores = {
        ...team.scores,
        [targetEvent.scoreType]: Math.max(
          0,
          (Number(team.scores[targetEvent.scoreType]) || 0) - targetEvent.scoreValue
        ),
      };

      return {
        ...team,
        scores: nextScores,
        totalScore: sumTeamScore(nextScores),
      };
    });

    const nextEvents = scoreEvents.filter((event) => event.id !== eventId);
    setTeams(nextTeams);
    setScoreEvents(nextEvents);
    await persistWorkshopSnapshot(nextTeams, nextEvents);
  }

  async function resetSession() {
    const supabase = supabaseRef.current;

    if (subscriptionRef.current && supabase) {
      supabase.removeChannel(subscriptionRef.current);
      subscriptionRef.current = null;
    }

    if (supabase && workshopId) {
      await supabase.from("workshops").delete().eq("id", workshopId);
    }

    localStorage.removeItem(STORAGE_KEY);
    setWorkshopId(null);
    setSessionCodeValue("");
    setTeams([]);
    setScoreEvents([]);
    setCurrentStep("setup");
    setCeremonyOpen(false);
    setCelebration({ open: false, place: null, team: null });
    setTeamCount(4);
    setDraftTeams(buildDraftTeams(4));
    setJoinCodeInput("");
  }

  async function handleJoinByCode() {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code || !syncEnabled) {
      return;
    }

    const payload = await fetchWorkshopByCode(code);
    if (!payload) {
      setConnectionState("코드 확인 필요");
      return;
    }

    localStorage.setItem(STORAGE_KEY, payload.workshop.id);
    setWorkshopId(payload.workshop.id);
    setSessionCodeValue(payload.workshop.session_code || code);
    applyRemotePayload(payload);
    subscribeToWorkshop(payload.workshop.id);
    setConnectionState("연결됨");
    setJoinCodeInput("");
  }

  async function requestFullscreenView() {
    const target = document.documentElement;
    if (!document.fullscreenElement && target?.requestFullscreen) {
      try {
        await target.requestFullscreen();
      } catch {
        return;
      }
    }
  }

  function exitFullscreenView() {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  async function openCeremonyMode() {
    setCeremonyOpen(true);
    setCelebration({ open: false, place: null, team: null });
    await requestFullscreenView();
  }

  function closeCeremonyMode() {
    setCeremonyOpen(false);
    setCelebration({ open: false, place: null, team: null });
    exitFullscreenView();
  }

  function openCelebration(place, team) {
    setCelebration({ open: true, place, team });
  }

  function closeCelebration() {
    setCelebration({ open: false, place: null, team: null });
  }

  function handleOverlayKeydown(event) {
    if (event.key === "Escape") {
      if (celebration.open) {
        closeCelebration();
      } else if (ceremonyOpen) {
        closeCeremonyMode();
      }
    }
  }

  useEffect(() => {
    document.addEventListener("keydown", handleOverlayKeydown);
    return () => document.removeEventListener("keydown", handleOverlayKeydown);
  });

  const celebrationCopy =
    celebration.place === 1
      ? "오늘의 레전드 팀입니다. 가장 큰 환호와 박수로 무대를 채워주세요."
      : celebration.place === 2
        ? "끝까지 치열하게 달려온 멋진 팀입니다. 뜨거운 박수로 함께 축하해주세요."
        : "유쾌한 에너지로 분위기를 살린 팀입니다. 모두 함께 축하해주세요.";

  return (
    <>
      <div className="background-glow background-glow-left"></div>
      <div className="background-glow background-glow-right"></div>

      <main className="app-shell">
        <section className="hero-card">
          <p className="eyebrow">Workshop Scoreboard</p>
          <h1>팀 점수판 운영 보드</h1>
          <p className="hero-copy">
            팀 수와 팀 정보를 저장하고, 미션 점수를 입력한 뒤 종합 페이지에서 실시간 결과를 확인할 수 있어요.
          </p>

          <div className="progress-steps" aria-label="진행 단계">
            {STEP_ORDER.map((step, index) => (
              <div
                key={step}
                className={`progress-step${currentStep === step ? " is-active" : ""}${
                  STEP_ORDER.indexOf(step) < STEP_ORDER.indexOf(currentStep) ? " is-complete" : ""
                }`}
              >
                <span>{index + 1}</span>
                <strong>{step === "setup" ? "팀 설정" : step === "score" ? "점수 입력" : "종합 보기"}</strong>
              </div>
            ))}
          </div>
        </section>

        <div className="connection-strip">
          <div className="status-pill">
            연결 상태 <strong>{connectionState}</strong>
          </div>
          <div className="status-pill">
            세션 코드 <strong>{sessionCodeValue || "없음"}</strong>
          </div>
        </div>

        <section className={`panel${currentStep === "setup" ? " is-visible" : ""}`}>
          <div className="panel-header">
            <p className="panel-kicker">STEP 1</p>
            <h2>팀 설정 저장</h2>
            <p>팀 수를 정하고 팀명과 팀 구호를 입력한 뒤 점수판을 만들면 Supabase에 저장됩니다.</p>
          </div>

          <div className="setup-layout">
            <section className="config-card">
              <label className="field-block" htmlFor="team-count-input">
                <span>팀 수</span>
                <input
                  id="team-count-input"
                  type="number"
                  min="2"
                  max="12"
                  step="1"
                  value={teamCount}
                  onChange={(event) => setTeamCount(clampTeamCount(Number(event.target.value) || 4))}
                />
              </label>
              <button className="secondary-button" type="button" onClick={handleBuildTeamForm}>
                팀 입력칸 만들기
              </button>
            </section>

            <section className="config-card">
              <h3>기존 세션 입장</h3>
              <label className="field-block">
                <span>세션 코드</span>
                <input
                  type="text"
                  maxLength="8"
                  placeholder="예: A1B2C3D4"
                  value={joinCodeInput}
                  onChange={(event) => setJoinCodeInput(event.target.value.toUpperCase())}
                />
              </label>
              <button className="primary-button" type="button" onClick={handleJoinByCode}>
                세션 입장하기
              </button>
            </section>

            <section className="config-card">
              <h3>팀 정보 입력</h3>
              <div className="team-form-grid">
                {draftTeams.map((team, index) => (
                  <article className="team-card" key={team.id}>
                    <div className="team-card-title">
                      <span className="team-chip">{index + 1}</span>
                      <h3>{index + 1}번 팀</h3>
                    </div>
                    <label className="field-block">
                      <span>팀명</span>
                      <input
                        className="team-name-input"
                        type="text"
                        maxLength="20"
                        value={team.name}
                        onChange={(event) =>
                          setDraftTeams((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, name: event.target.value } : item
                            )
                          )
                        }
                      />
                    </label>
                    <label className="field-block">
                      <span>팀 구호</span>
                      <input
                        className="team-motto-input"
                        type="text"
                        maxLength="40"
                        value={team.motto}
                        onChange={(event) =>
                          setDraftTeams((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, motto: event.target.value } : item
                            )
                          )
                        }
                      />
                    </label>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <div className="panel-actions">
            <button className="primary-button" type="button" onClick={handleSaveScoreboard}>
              점수판 만들기
            </button>
          </div>
        </section>

        <section className={`panel${currentStep === "score" ? " is-visible" : ""}`}>
          <div className="panel-header">
            <p className="panel-kicker">STEP 2</p>
            <h2>팀 점수 입력</h2>
            <p>팀을 선택하고 미션 종류를 고른 뒤 점수를 입력하면 해당 팀 점수에 바로 반영됩니다.</p>
          </div>

          <div className="score-layout">
            <section className="score-form-card">
              <div className="score-form-intro">
                <p className="panel-kicker">SCORE INPUT</p>
                <h3>팀과 항목을 고른 뒤 점수를 추가하세요</h3>
              </div>
              <div className="field-grid">
                <label className="field-block field-block-wide">
                  <span>팀 선택</span>
                  <select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {formatTeamLabel(team)} ({team.totalScore}점)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-block field-block-half">
                  <span>점수 항목</span>
                  <select value={selectedScoreType} onChange={(event) => setSelectedScoreType(event.target.value)}>
                    {SCORE_TYPES.map((type) => (
                      <option key={type.key} value={type.key}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-block field-block-half">
                  <span>점수</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    step="1"
                    value={scoreValue}
                    onChange={(event) => setScoreValue(event.target.value)}
                  />
                </label>
              </div>

              <div className="score-action-row">
                <button className="primary-button" type="button" onClick={handleAddScore} disabled={!teams.length}>
                  추가
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setCurrentStep("summary")}
                  disabled={!teams.length}
                >
                  종합 페이지 보기
                </button>
              </div>
            </section>

            <section className="score-form-card">
              <div className="inline-header">
                <h3>최근 점수 변경</h3>
                <button className="ghost-button" id="reset-session-button" type="button" onClick={resetSession}>
                  세션 초기화
                </button>
              </div>
              <EventFeed events={scoreEvents} onDelete={handleDeleteScoreEvent} />
            </section>
          </div>
        </section>

        <section className={`panel${currentStep === "summary" ? " is-visible" : ""}`}>
          <div className="panel-header">
            <p className="panel-kicker">STEP 3</p>
            <h2>종합 페이지</h2>
            <p>팀별 총점과 마지막 변경 내역을 함께 보면서 현재 순위를 바로 확인할 수 있습니다.</p>
          </div>

          <div className="summary-layout">
            <section className="summary-card spotlight-card">
              <span>현재 1등</span>
              <strong>{leader ? formatTeamLabel(leader) : "없음"}</strong>
              <p>
                {leader
                  ? `${leader.totalScore}점으로 현재 선두입니다. "${leader.motto}"`
                  : "점수를 입력하면 결과가 여기에 표시됩니다."}
              </p>
            </section>

            <section className="summary-card">
              <div className="inline-header">
                <h3>팀별 총점</h3>
                <span>{`총 ${rankedTeams.length}팀`}</span>
              </div>
              <div className="ranking-list">
                {rankedTeams.length === 0 ? (
                  <div className="empty-state">아직 저장된 팀 결과가 없습니다.</div>
                ) : (
                  rankedTeams.map((team, index) => (
                    <article className="ranking-item" key={team.id}>
                      <div className="ranking-rank">{index + 1}</div>
                      <div>
                        <strong>{formatTeamLabel(team)}</strong>
                        <div className="ranking-meta">{team.motto}</div>
                      </div>
                      <div className="ranking-score">{team.totalScore}점</div>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="summary-card full-width">
              <div className="inline-header">
                <h3>변경 내역</h3>
                <div className="summary-action-group">
                  <button className="secondary-button" type="button" onClick={() => setCurrentStep("score")}>
                    점수 입력으로 돌아가기
                  </button>
                  <button className="primary-button" type="button" onClick={openCeremonyMode}>
                    완료
                  </button>
                </div>
              </div>
              <EventFeed events={scoreEvents} onDelete={handleDeleteScoreEvent} />
            </section>
          </div>
        </section>
      </main>

      <section className={`ceremony-screen${ceremonyOpen ? " is-visible" : ""}`} aria-hidden={!ceremonyOpen}>
        <div className="ceremony-shell">
          <div className="ceremony-header">
            <div>
              <p className="eyebrow">Final Ranking</p>
              <h2>시상식 결과</h2>
              <p className="ceremony-copy">
                1등부터 8등까지 순위를 한눈에 보고, 1등부터 3등까지는 축하 화면으로 크게 띄워보세요.
              </p>
            </div>
            <button className="secondary-button ceremony-close-button" type="button" onClick={closeCeremonyMode}>
              돌아가기
            </button>
          </div>

          <div className="ceremony-layout">
            <section className="ceremony-card celebration-launcher">
              <div className="inline-header">
                <h3>시상 버튼</h3>
                <span>{`TOP ${Math.min(3, rankedTeams.length)}`}</span>
              </div>
              <div className="winner-button-group">
                {rankedTeams.length === 0 ? (
                  <div className="empty-state">먼저 점수를 입력한 뒤 완료를 눌러주세요.</div>
                ) : (
                  rankedTeams.slice(0, 3).map((team, index) => (
                    <button
                      key={team.id}
                      type="button"
                      className={`winner-launch-button place-${index + 1}`}
                      onClick={() => openCelebration(index + 1, team)}
                    >
                      {index + 1}등 축하
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="ceremony-card">
              <div className="inline-header">
                <h3>최종 순위</h3>
                <span>TOP 8</span>
              </div>
              <div className="ceremony-ranking-list">
                {rankedTeams.length === 0 ? (
                  <div className="empty-state">아직 시상할 점수 결과가 없습니다.</div>
                ) : (
                  rankedTeams.slice(0, 8).map((team, index) => (
                    <article className={`ceremony-ranking-item place-${index + 1}`} key={team.id}>
                      <div className="ceremony-rank-badge">{index + 1}등</div>
                      <div className="ceremony-rank-body">
                        <strong>{formatTeamLabel(team)}</strong>
                        <span>{team.motto}</span>
                      </div>
                      <div className="ceremony-rank-score">{team.totalScore}점</div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </section>

      <section
        className={`celebration-overlay${celebration.open ? " is-visible" : ""}${
          celebration.place ? ` place-${celebration.place}` : ""
        }`}
        aria-hidden={!celebration.open}
        onClick={(event) => {
          if (event.target.classList.contains("celebration-overlay") || event.target.classList.contains("celebration-backdrop")) {
            closeCelebration();
          }
        }}
      >
        <div className="celebration-backdrop"></div>
        <div className="celebration-burst celebration-burst-left"></div>
        <div className="celebration-burst celebration-burst-right"></div>
        <div className="celebration-card">
          <p className="eyebrow">Celebration</p>
          <h2>
            {celebration.place ? `${celebration.place}등 축하합니다` : "시상식"} 
          </h2>
          <p className="celebration-team">
            {celebration.team ? `${formatTeamLabel(celebration.team)} · ${celebration.team.totalScore}점` : "팀 정보가 없습니다."}
          </p>
          <p className="celebration-copy">{celebrationCopy}</p>
          <button className="primary-button celebration-close-button" type="button" onClick={closeCelebration}>
            닫기
          </button>
        </div>
      </section>
    </>
  );
}

function EventFeed({ events, onDelete }) {
  if (events.length === 0) {
    return <div className="empty-state">아직 점수 변경 내역이 없습니다.</div>;
  }

  return (
    <div className="event-feed">
      {events.map((event) => (
        <article className="event-item" key={event.id}>
          <div className="event-row">
            <strong>{`${event.teamName} · ${event.scoreLabel} · +${event.scoreValue}점`}</strong>
            <button className="event-delete-button" type="button" onClick={() => onDelete(event.id)}>
              삭제
            </button>
          </div>
          <div className="event-meta">{formatEventTime(event.createdAt)}</div>
        </article>
      ))}
    </div>
  );
}

function upperSessionCode(workshopId) {
  return typeof workshopId === "string" ? workshopId.replaceAll("-", "").slice(0, 8).toUpperCase() : "";
}
