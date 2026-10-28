// Isolated-world relay: converts the page event into a message the extension
// can receive. No data ever leaves the machine.
(function () {
  const REQUEST_EVENT = 'dsum:token-request';
  const RESPONSE_EVENT = 'dsum:token-response';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'dsum:read-token') return false;

    let settled = false;
    const onResponse = (event) => {
      settled = true;
      document.removeEventListener(RESPONSE_EVENT, onResponse);
      sendResponse({ token: event?.detail?.token || null });
    };

    document.addEventListener(RESPONSE_EVENT, onResponse);
    document.dispatchEvent(new CustomEvent(REQUEST_EVENT));

    setTimeout(() => {
      if (settled) return;
      document.removeEventListener(RESPONSE_EVENT, onResponse);
      sendResponse({ token: null });
    }, 1000);

    return true; // keep the channel open for the async reply
  });
})();
