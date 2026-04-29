chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'FETCH') {
    fetch(request.url, request.options)
      .then(async response => {
        const text = await response.text();
        sendResponse({ success: true, text: text, status: response.status });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }
});
