type EventPayload = {
  company?: string;
  region?: string;
  city?: string;
  targetUrl?: string;
};

const sessionKey = 'foreignRadarSessionId';

function getSessionId(): string {
  let sessionId = localStorage.getItem(sessionKey);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(sessionKey, sessionId);
  }
  return sessionId;
}

export function trackEvent(eventName: string, payload: EventPayload = {}) {
  const body = JSON.stringify({
    eventName,
    ...payload,
    path: window.location.pathname,
    sessionId: getSessionId(),
  });

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon('/api/track', blob);
    return;
  }

  fetch('/api/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
