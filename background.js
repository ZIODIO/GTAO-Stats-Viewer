const SERVER_URL = "http://127.0.0.1:39842";
const BASE_URL   = "https://socialclub.rockstargames.com";

// 토큰을 기억해둘 저장소 추가
const tokenCache = {};

async function getToken(url) {
  // 1. 이미 기억하고 있는 토큰이 있으면 통신 안 하고 바로 꺼내 씀 (초고속!)
  if (tokenCache[url]) {
    return tokenCache[url];
  }

  // 2. 없으면 락스타 서버에서 가져옴
  const resp = await fetch(url, {
    credentials: "include",
    headers: { "Accept-Language": "ko-KR,ko;q=0.9" }
  });
  
  const html = await resp.text();
  const match = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  
  if (match) {
    tokenCache[url] = match[1]; // 다음번 검색을 위해 저장
    return match[1];
  }
  return "";
}

async function fetchStats(nickname) {
  try {
    const ts = Date.now();

    const [token, statsToken] = await Promise.all([
      getToken(`${BASE_URL}/member/${encodeURIComponent(nickname)}/games/gtav/pcalt/career/overview/gtaonline`),
      getToken(`${BASE_URL}/member/${encodeURIComponent(nickname)}/games/gtav/pcalt/career/stats/gtaonline/career`),
    ]);

    console.log("[GTAO] 토큰 추출 완료");

    const headers = (t) => ({
      "Accept":                     "text/html, */*; q=0.01",
      "Accept-Language":            "ko-KR,ko;q=0.9",
      "X-Requested-With":           "XMLHttpRequest",
      "__RequestVerificationToken": t,
    });

    const overviewUrl = `${BASE_URL}/games/gtav/career/overviewAjax?character=Freemode&nickname=${encodeURIComponent(nickname)}&slot=Freemode&gamerHandle=&gamerTag=&_=${ts}`;
    const statsUrl    = `${BASE_URL}/games/gtav/StatsAjax?character=Freemode&category=Career&nickname=${encodeURIComponent(nickname)}&slot=Freemode&gamerHandle=&gamerTag=&_=${ts}`;
    const awardsUrl   = `${BASE_URL}/games/gtav/career/AwardsAjax?slot=Freemode&nickname=${encodeURIComponent(nickname)}&category=general&_=${ts}`;

    const [overviewResp, statsResp, awardsResp] = await Promise.all([
      fetch(overviewUrl, { headers: headers(token),      credentials: "include" }),
      fetch(statsUrl,    { headers: headers(statsToken), credentials: "include" }),
      fetch(awardsUrl,   { headers: headers(token),      credentials: "include" }),
    ]);

    const overviewHtml = await overviewResp.text();
    const statsHtml    = await statsResp.text();
    const awardsHtml   = await awardsResp.text();

    console.log("[GTAO] overview:", overviewHtml.length, "stats:", statsHtml.length, "awards:", awardsHtml.length);

    return { success: true, overview: overviewHtml, stats: statsHtml, awards: awardsHtml, nickname };
  } catch (e) {
    console.log("[GTAO] fetchStats 오류:", e.message);
    return { success: false, error: e.message };
  }
}

async function fetchAwardCategory(nickname, category, token) {
  try {
    const ts  = Date.now();
    const url = `${BASE_URL}/games/gtav/career/AwardsAjax?slot=Freemode&nickname=${encodeURIComponent(nickname)}&category=${category}&_=${ts}`;
    const resp = await fetch(url, {
      headers: {
        "Accept":                     "text/html, */*; q=0.01",
        "Accept-Language":            "ko-KR,ko;q=0.9",
        "X-Requested-With":           "XMLHttpRequest",
        "__RequestVerificationToken": token,
      },
      credentials: "include",
    });
    const html = await resp.text();
    return { success: true, html, category };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function pollFromPython() {
  while (true) {
    try {
      const resp = await fetch(`${SERVER_URL}/pending`, {
        signal: AbortSignal.timeout(30000),
      });

      if (resp.ok) {
        const data = await resp.json();

        if (data.nickname) {
          console.log("[GTAO] 통계 요청:", data.nickname);
          const result = await fetchStats(data.nickname);
          await fetch(`${SERVER_URL}/result`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(result),
          });
        }

        if (data.award_category) {
          console.log("[GTAO] 어워드 요청:", data.award_category, data.award_nickname);
          const token = await getToken(
            `${BASE_URL}/member/${encodeURIComponent(data.award_nickname)}/games/gtav/pcalt/career/awards/general`
          );
          const result = await fetchAwardCategory(data.award_nickname, data.award_category, token);
          await fetch(`${SERVER_URL}/award_result`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(result),
          });
        }
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

chrome.alarms.create("keepAlive", { periodInMinutes: 0.2 }); // 12초마다
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    console.log("[GTAO] keepAlive");
  }
});

// 시작하자마자 즉시 연결 시도
fetch("http://127.0.0.1:39842/pending", { signal: AbortSignal.timeout(500) })
  .catch(() => {});

pollFromPython();
