let isProcessing = false;
let currentProgress = { total: 0, current: 0, lastFileName: "" };

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
    return true;
  }

  if (request.type === 'START_DOWNLOAD_QUEUE') {
    const files = request.files;
    currentProgress = { total: files.length, current: 0, lastFileName: "" };
    isProcessing = true;
    
    // Start all downloads in parallel with a small stagger to avoid rate limiting
    files.forEach((item, index) => {
      setTimeout(() => {
        downloadFile(item);
      }, index * 200); 
    });
    
    sendResponse({ success: true });
  }

  if (request.type === 'GET_DOWNLOAD_STATUS') {
    sendResponse({ isProcessing, progress: currentProgress });
  }
});

async function downloadFile(item) {
  try {
    let finalUrl = "";
    // Try get_video_info first
    const infoUrl = `https://drive.google.com/u/0/get_video_info?docid=${item.id}&drive_originator_app=303`;
    const infoRes = await fetch(infoUrl);
    const infoText = await infoRes.text();
    const params = parseParams(infoText);
    const streams = parseStreams(params);

    if (streams.length > 0) {
      finalUrl = streams[0].url;
    } else {
      const ucUrl = `https://drive.google.com/uc?id=${item.id}&export=download`;
      const ucRes = await fetch(ucUrl);
      const ucHtml = await ucRes.text();
      finalUrl = extractConfirmLink(ucHtml) || ucUrl;
    }

    chrome.downloads.download({
      url: finalUrl,
      filename: item.path.replace(/[\\*?:"<>|]/g, "").trim(),
      saveAs: false
    });
  } catch (e) {
    console.error("Download error for", item.name, e);
  } finally {
    currentProgress.current++;
    currentProgress.lastFileName = item.name;
    if (currentProgress.current >= currentProgress.total) {
      isProcessing = false;
    }
  }
}

function parseParams(text) {
  const params = {};
  text.split('&').forEach(pair => { const [k, v] = pair.split('='); if (k && v) params[k] = v; });
  return params;
}

function parseStreams(params) {
  const qMap = { '37': 1080, '22': 720, '59': 480, '18': 360 };
  const streams = [];
  if (params.fmt_stream_map) {
    decodeURIComponent(params.fmt_stream_map).split(',').forEach(s => {
      const p = s.split('|');
      if (p.length >= 2) streams.push({ priority: qMap[p[0]] || 0, url: p[1], itag: p[0] });
    });
  }
  return streams.sort((a, b) => b.priority - a.priority);
}

function extractConfirmLink(html) {
  const hrefMatch = html.match(/href="(\/uc\?export=download[^"]+)/);
  if (hrefMatch) return "https://docs.google.com" + hrefMatch[1].replace(/&amp;/g, "&");
  const dlMatch = html.match(/"downloadUrl":"([^"]+)"/);
  if (dlMatch) return dlMatch[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
  return null;
}
