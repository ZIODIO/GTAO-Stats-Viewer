const SERVER_URL = "http://localhost:39842";
const BASE_URL   = "https://socialclub.rockstargames.com";

async function getToken(url) {
  const resp = await fetch(url, {
    credentials: "include",
    headers: { "Accept-Language": "ko-KR,ko;q=0.9" }
  });
  const html = await resp.text();
  const match = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  return { token: match ? match[1] : "", html };
}

async function fetchStats(nickname, platform = "pcalt") {
  try {
    const ts = Date.now();

    // overview 페이지에서 토큰 추출 + 닉네임 존재 확인
    const { token, html: pageHtml } = await getToken(
      `${BASE_URL}/member/${encodeURIComponent(nickname)}/games/gtav/${platform}/career/overview/gtaonline`
    );

    // 닉네임이 페이지에 없으면 존재하지 않는 유저
    if (!pageHtml.includes("freemodeRank") && !pageHtml.includes("authUserNickName")) {
      return { success: false, error: "존재하지 않는 닉네임입니다." };
    }

    const { token: statsToken } = await getToken(
      `${BASE_URL}/member/${encodeURIComponent(nickname)}/games/gtav/${platform}/career/stats/gtaonline/career`
    );

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
    const url = `${BASE_URL}/games/gtav/career/AwardsAjax?slot=Freemode&nickname=${encodeURIComponent(nickname)}&category=${category}&lang=ko&_=${ts}`;
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
          console.log("[GTAO] 통계 요청:", data.nickname, data.platform);
          const result = await fetchStats(data.nickname, data.platform || "pcalt");
          await fetch(`${SERVER_URL}/result`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(result),
          });
        }

        if (data.award_category) {
          console.log("[GTAO] 어워드 요청:", data.award_category, data.award_nickname);
          const { token } = await getToken(
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

// 시작하자마자 즉시 연결 시도
fetch("http://localhost:39842/pending", { signal: AbortSignal.timeout(500) })
  .catch(() => {});

chrome.alarms.create("keepAlive", { periodInMinutes: 0.2 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    console.log("[GTAO] keepAlive");
  }
});

pollFromPython();
