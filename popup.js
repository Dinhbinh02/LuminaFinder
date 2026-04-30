document.addEventListener('DOMContentLoaded', async () => {
  const downloadBtn = document.getElementById('download-btn');
  const copyBtn = document.getElementById('copy-btn');
  const optionSelect = document.getElementById('option-select');
  const optionSection = document.getElementById('option-section');
  const statusLabel = document.getElementById('status');
  const targetTitleLabel = document.getElementById('target-title');
  const targetTypeBadge = document.getElementById('target-type');
  const folderContent = document.getElementById('folder-content');
  const fileListContainer = document.getElementById('file-list-container');
  const selectAllCheckbox = document.getElementById('select-all-checkbox');
  const reloadBtn = document.getElementById('reload-btn');
  const bulkTip = document.getElementById('bulk-tip');
  const closeTipBtn = document.getElementById('close-tip');

  chrome.storage.local.get(['tipDismissed'], (res) => {
    if (!res.tipDismissed) {
      bulkTip.style.display = 'block';
    }
  });

  closeTipBtn.addEventListener('click', () => {
    bulkTip.style.display = 'none';
    chrome.storage.local.set({ tipDismissed: true });
  });

  async function proxyFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FETCH', url, options }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve({
            text: () => Promise.resolve(response.text),
            status: response.status,
            ok: response.status >= 200 && response.status < 300
          });
        } else {
          reject(new Error(response ? response.error : 'Unknown error'));
        }
      });
    });
  }

  const ICONS = {
    chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
    chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
    reload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`
  };

  reloadBtn.innerHTML = ICONS.reload;

  let currentTarget = {
    url: "", id: "", type: "file", title: "", downloadUrl: "", streams: [], folderTree: null, isScanning: false
  };
  let statusInterval = null;

  function updateStatusUI(progress) {
    const { current, total, lastFileName, statusText } = progress;
    const progressCount = total > 1 ? `(${current}/${total}) ` : "";
    let action = "Downloading";
    let warning = "";
    
    if (statusText) {
      if (statusText.includes('|')) {
        const parts = statusText.split('|');
        action = parts[0];
        warning = parts[1];
      } else {
        action = statusText;
      }
    }
    
    let fileDisplay = lastFileName ? `<b>${lastFileName}</b>` : "<i>Preparing...</i>";
    let finalHtml = `${progressCount}${action}: ${fileDisplay}`;
    if (action === "Starting...") finalHtml = `<i>Initializing queue...</i>`;
    if (warning) finalHtml += `<br><span style="color: #ef4444; font-weight: 600; margin-top: 6px; display: block;">⚠️ ${warning}</span>`;
    
    statusLabel.innerHTML = finalHtml;
    downloadBtn.disabled = true;
    targetTitleLabel.innerText = "Lumina Finder";
    targetTypeBadge.innerText = "BUSY";
    const targetHeader = document.querySelector('.target-header');
    if (targetHeader) targetHeader.style.marginBottom = "0";
    folderContent.style.display = "none";
    optionSection.style.display = "none";
  }

  async function init() {
    chrome.runtime.sendMessage({ type: 'GET_DOWNLOAD_STATUS' }, async response => {
      if (response && response.isProcessing) {
        updateStatusUI(response.progress);
        startPolling();
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tab.url;
        const cache = await chrome.storage.local.get(['lastState']);
        if (cache.lastState && cache.lastState.url === currentUrl) {
          currentTarget = cache.lastState;
          if (currentTarget.type === "folder") {
            renderState();
            if (!currentTarget.isScanning) statusLabel.innerText = "Ready.";
          } else {
            analyzeUrl(currentUrl, tab);
          }
        } else {
          analyzeUrl(currentUrl, tab);
        }
        startPolling();
      }
    });
  }

  function startPolling() {
    setInterval(() => {
      chrome.runtime.sendMessage({ type: 'GET_DOWNLOAD_STATUS' }, response => {
        if (response && response.isProcessing) {
          updateStatusUI(response.progress);
        } else if (downloadBtn.disabled && !currentTarget.isScanning) {
          statusLabel.innerText = "Complete.";
          downloadBtn.disabled = false;
          updateDownloadBtnState();
          saveState();
        }
      });
    }, 1000);
  }

  init();

  async function analyzeUrl(url, tabObj) {
    currentTarget = {
      id: '', type: 'none', title: '', url: url,
      downloadUrl: '', folderTree: null, isScanning: false,
      streams: []
    };
    renderState();

    const fileId = extractFileId(url);
    const folderId = extractFolderId(url);
    const docInfo = extractDocInfo(url);

    if (folderId) {
      currentTarget.id = folderId; currentTarget.type = "folder";
      targetTitleLabel.innerText = "Folder";
      renderState();
      autoScanFolder();
    } else if (docInfo) {
      currentTarget.id = docInfo.id; currentTarget.type = docInfo.type;
      let cleanTitle = tabObj.title || "Document";
      cleanTitle = cleanTitle.replace(/ - Google (Docs|Sheets|Slides|Documents|Spreadsheets|Presentations)$/, "");
      currentTarget.title = cleanTitle;
      targetTitleLabel.innerText = currentTarget.title;
      renderState();
      let internalType = "doc";
      if (currentTarget.type === "spreadsheets") internalType = "sheet";
      if (currentTarget.type === "presentation") internalType = "slide";
      setupExportOptions(internalType);
      saveState();
      statusLabel.innerText = "Ready.";
    } else if (fileId) {
      currentTarget.id = fileId; currentTarget.type = "file";
      let cleanTitle = tabObj.title || "File";
      cleanTitle = cleanTitle.replace(/ - Google Drive$/, "");
      currentTarget.title = cleanTitle;
      targetTitleLabel.innerText = currentTarget.title;
      renderState();
      await checkFileInfo(fileId);
      saveState();
      statusLabel.innerText = "Complete.";
    } else {
      targetTitleLabel.innerText = "Lumina Finder";
      statusLabel.innerText = "Please open the file or folder you want to download.";
      currentTarget.type = "none";
      renderState();
    }
  }

  function saveState() { chrome.storage.local.set({ lastState: currentTarget }); }

  function renderState() {
    const type = currentTarget.type.toLowerCase();
    targetTypeBadge.innerText = type.toUpperCase();
    const cleanTitle = (currentTarget.title || "Item").replace(/\.(docx|xlsx|pptx|gdoc|gsheet|gslides)$/i, "");
    targetTitleLabel.innerText = cleanTitle;
    const selectAllGroup = document.getElementById('select-all-group');
    const targetHeader = document.querySelector('.target-header');
    targetHeader.style.marginBottom = "0";
    if (currentTarget.type === "folder") {
      folderContent.style.display = "block";
      selectAllGroup.style.display = "flex";
      if (!currentTarget.isScanning && currentTarget.folderTree) targetHeader.style.marginBottom = "12px";
      renderTree();
      updateDownloadBtnState();
      updateSelectAllState();
    } else {
      folderContent.style.display = "none";
      selectAllGroup.style.display = "none";
      targetHeader.style.marginBottom = "0";
      const isDoc = ["document", "spreadsheets", "presentation"].includes(currentTarget.type);
      const isDownloadable = currentTarget.downloadUrl || currentTarget.streams.length > 0 || isDoc;
      downloadBtn.disabled = !isDownloadable;
      downloadBtn.innerText = "Download";
      if (isDoc) {
        let internalType = "doc";
        if (currentTarget.type === "spreadsheets") internalType = "sheet";
        if (currentTarget.type === "presentation") internalType = "slide";
        setupExportOptions(internalType);
      }
      else if (currentTarget.streams.length > 0) setupQualityOptions(currentTarget.streams, !!currentTarget.downloadUrl);
      else optionSection.style.display = "none";
    }
  }

  function renderTree() {
    fileListContainer.innerHTML = "";
    if (currentTarget.folderTree) renderNode(currentTarget.folderTree, fileListContainer, 0);
  }

  function renderNode(node, container, depth) {
    const item = document.createElement('div');
    item.className = "folder-item";
    const row = document.createElement('div');
    row.className = "item-row";
    if (depth > 0) row.style.paddingLeft = `${depth * 16}px`;
    const isFolder = node.type === 'folder';
    const toggleIconMarkup = isFolder ? (node.expanded ? ICONS.chevronDown : ICONS.chevronRight) : '';
    const displayName = isFolder ? node.name : node.name.replace(/\.(docx|xlsx|pptx|gdoc|gsheet|gslides)$/i, "");
    row.innerHTML = `<span class="toggle-icon">${toggleIconMarkup}</span><input type="checkbox" class="node-checkbox" ${node.selected ? 'checked' : ''}><span class="${isFolder ? 'folder-name' : 'file-name'}">${displayName}</span>`;
    row.querySelector('.toggle-icon').addEventListener('click', (e) => { e.stopPropagation(); if (isFolder) { node.expanded = !node.expanded; renderTree(); saveState(); } });
    row.querySelector('.node-checkbox').addEventListener('click', (e) => { e.stopPropagation(); propagateDown(node, e.target.checked); propagateUp(currentTarget.folderTree); updateSelectAllState(); updateDownloadBtnState(); renderTree(); saveState(); });
    row.addEventListener('click', (e) => { if (e.target.closest('.toggle-icon') && isFolder) return; if (e.target.classList.contains('node-checkbox')) return; propagateDown(node, !node.selected); propagateUp(currentTarget.folderTree); updateSelectAllState(); updateDownloadBtnState(); renderTree(); saveState(); });
    item.appendChild(row);
    container.appendChild(item);
    if (isFolder && node.expanded && node.children) node.children.forEach(child => renderNode(child, container, depth + 1));
  }

  function propagateDown(node, selected) { node.selected = selected; if (node.children) node.children.forEach(child => propagateDown(child, selected)); }
  function propagateUp(node) { if (node.children && node.children.length > 0) { node.children.forEach(propagateUp); node.selected = node.children.every(child => child.selected); } }
  function updateDownloadBtnState() { if (currentTarget.type === "folder" && currentTarget.folderTree) { const allFiles = flattenFiles(currentTarget.folderTree); const selectedFiles = allFiles.filter(f => f.selected); downloadBtn.disabled = selectedFiles.length === 0; downloadBtn.innerText = selectedFiles.length === 0 ? "Select files" : `Download (${selectedFiles.length})`; } }
  function updateSelectAllState() { if (currentTarget.folderTree) selectAllCheckbox.checked = currentTarget.folderTree.selected; }
  function flattenFiles(node, path = "") { let files = []; const currentPath = path + (node.name ? node.name + "/" : ""); if (node.type === 'file') files.push({ ...node, path: path + node.name }); else if (node.children) node.children.forEach(child => { files = files.concat(flattenFiles(child, currentPath)); }); return files; }

  selectAllCheckbox.addEventListener('change', (e) => { if (currentTarget.folderTree) { propagateDown(currentTarget.folderTree, e.target.checked); renderTree(); updateDownloadBtnState(); saveState(); } });
  reloadBtn.addEventListener('click', () => { statusLabel.innerText = "Reloading..."; analyzeUrl(currentUrl, tab); });

  function startDynamicStatus() {
    if (statusInterval) clearInterval(statusInterval);
    const words = ["Scanning", "Mapping", "Indexing", "Fetching", "Parsing"];
    let wordIdx = 0, dotCount = 0, cycleCount = 0;
    statusInterval = setInterval(() => {
      if (!currentTarget.isScanning) { clearInterval(statusInterval); return; }
      dotCount++; if (dotCount > 3) { dotCount = 1; cycleCount++; }
      if (cycleCount >= 2) { cycleCount = 0; if (wordIdx < words.length - 1) wordIdx++; }
      statusLabel.innerText = words[wordIdx] + ".".repeat(dotCount);
    }, 500);
  }

  async function autoScanFolder() {
    if (currentTarget.isScanning) return;
    currentTarget.isScanning = true; startDynamicStatus(); renderState();
    try {
      currentTarget.folderTree = await recursiveScanTree(currentTarget.id, "");
      currentTarget.isScanning = false; currentTarget.title = currentTarget.folderTree.name;
      statusLabel.innerText = "Ready."; renderState(); saveState();
    } catch (e) { statusLabel.innerText = "Error: " + e.message; currentTarget.isScanning = false; }
  }

  async function recursiveScanTree(folderId, name) {
    const embeddedUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}`;
    const response = await proxyFetch(embeddedUrl);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const folderName = name || (doc.title ? doc.title.replace(" - Google Drive", "") : "Folder");
    const node = { id: folderId, name: folderName, type: 'folder', children: [], expanded: true, selected: true };
    const links = doc.querySelectorAll('a[href]');
    const seenIds = new Set();
    const folderPromises = [];
    for (const link of links) {
      const href = link.getAttribute('href') || "";
      const childName = link.innerText.trim() || "Item";
      let id = "", type = "";
      if (href.includes("/folders/")) { const m = href.match(/\/folders\/([a-zA-Z0-9_-]+)/); if (m) { id = m[1]; type = "folder"; } }
      else if (href.includes("/file/d/")) { const m = href.match(/\/file\/d\/([a-zA-Z0-9_-]+)/); if (m) { id = m[1]; type = "file"; } }
      else if (href.includes("/d/")) { const m = href.match(/\/d\/([a-zA-Z0-9_-]+)/); if (m) { id = m[1]; type = "file"; } }
      if (id && type && !seenIds.has(id)) {
        seenIds.add(id);
        if (type === "folder") folderPromises.push(recursiveScanTree(id, childName).then(sub => { node.children.push(sub); renderTree(); }));
        else { const fullUrl = href.startsWith('http') ? href : `https://drive.google.com${href}`; node.children.push({ id, name: childName, type: 'file', url: fullUrl, selected: true }); renderTree(); }
      }
    }
    await Promise.all(folderPromises); return node;
  }

  downloadBtn.addEventListener('click', async () => {
    if (currentTarget.type === "folder") {
      const selectedFiles = flattenFiles(currentTarget.folderTree).filter(f => f.selected);
      if (selectedFiles.length === 0) { statusLabel.innerText = "No files selected."; return; }
      chrome.runtime.sendMessage({ type: 'START_DOWNLOAD_QUEUE', files: selectedFiles }, () => { statusLabel.innerText = "Processing in background..."; downloadBtn.disabled = true; });
    } else {
      const singleFile = { id: currentTarget.id, name: currentTarget.title, path: currentTarget.title, url: currentTarget.url };
      chrome.runtime.sendMessage({ type: 'START_DOWNLOAD_QUEUE', files: [singleFile] }, () => { statusLabel.innerText = "Processing in background..."; downloadBtn.disabled = true; });
    }
  });

  function extractConfirmLink(html) { const m = html.match(/href="(\/uc\?export=download[^"]+)/); if (m) return "https://docs.google.com" + m[1].replace(/&amp;/g, "&"); const dl = html.match(/"downloadUrl":"([^"]+)"/); if (dl) return dl[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&"); return null; }
  function extractFileId(url) { const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/); return m ? m[1] : (url.includes('id=') ? new URLSearchParams(new URL(url).search).get('id') : null); }
  function extractFolderId(url) { const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/); return m ? m[1] : null; }
  function extractDocInfo(url) { const segs = ['document', 'spreadsheets', 'presentation']; for (const s of segs) { if (url.includes(`google.com/${s}/d/`)) { const m = url.match(new RegExp(`${s}/d/([a-zA-Z0-9_-]+)`)); if (m) return { id: m[1], type: s }; } } if (url.includes('google.com/docs/d/')) { const m = url.match(/\/docs\/d\/([a-zA-Z0-9_-]+)/); if (m) return { id: m[1], type: 'document' }; } return null; }
  function parseParams(text) { const p = {}; text.split('&').forEach(pair => { const [k, v] = pair.split('='); if (k && v) p[k] = v; }); return p; }
  function parseStreams(params) { const qMap = { '37': 1080, '22': 720, '59': 480, '18': 360 }; const sArr = []; if (params.fmt_stream_map) { decodeURIComponent(params.fmt_stream_map).split(',').forEach(s => { const p = s.split('|'); if (p.length >= 2) sArr.push({ priority: qMap[p[0]] || 0, url: p[1], itag: p[0] }); }); } return sArr.sort((a, b) => b.priority - a.priority); }

  async function checkFileInfo(id) {
    const ucUrl = `https://drive.google.com/uc?id=${id}&export=download`;
    const ucRes = await proxyFetch(ucUrl);
    const ucHtml = await ucRes.text();
    const tM = ucHtml.match(/<title>(.*?) - Google Drive<\/title>/);
    if (tM) { currentTarget.title = tM[1]; targetTitleLabel.innerText = currentTarget.title; }
    const cU = extractConfirmLink(ucHtml); if (cU) currentTarget.downloadUrl = cU;
    try {
      const infoRes = await proxyFetch(`https://drive.google.com/u/0/get_video_info?docid=${id}&drive_originator_app=303`);
      const infoT = await infoRes.text();
      const streams = parseStreams(parseParams(infoT));
      if (streams.length > 0) currentTarget.streams = streams;
    } catch (e) { }
    renderState();
  }

  function setupQualityOptions(streams, hasHighSpeedLink) { optionSelect.innerHTML = ""; if (hasHighSpeedLink) { const opt = document.createElement('option'); opt.value = "original"; opt.text = "Original Link"; optionSelect.appendChild(opt); } streams.forEach((s, i) => { const opt = document.createElement('option'); opt.value = i; opt.text = s.priority > 0 ? `${s.priority}p` : `itag ${s.itag}`; optionSelect.appendChild(opt); }); optionSection.style.display = "block"; }
  function setupExportOptions(type) { optionSelect.innerHTML = ""; let fmts = []; if (type === "doc") fmts = ["pdf", "docx", "txt", "odt"]; else if (type === "sheet") fmts = ["pdf", "xlsx", "csv", "ods"]; else if (type === "slide") fmts = ["pdf", "pptx", "txt"]; fmts.forEach(f => { const opt = document.createElement('option'); opt.value = f; opt.text = f.toUpperCase(); optionSelect.appendChild(opt); }); optionSection.style.display = "block"; }

  copyBtn.addEventListener('click', async () => {
    try {
      const dC = await chrome.cookies.getAll({ domain: "drive.google.com" });
      const gC = await chrome.cookies.getAll({ domain: "google.com" });
      const unique = Array.from(new Map([...dC, ...gC].map(c => [c.name, c])).values());
      await navigator.clipboard.writeText(JSON.stringify({ id: currentTarget.id, type: currentTarget.type, title: currentTarget.title, cookies: unique, url: currentUrl }));
      copyBtn.innerText = "Copied"; setTimeout(() => { copyBtn.innerText = "Metadata"; }, 2000);
    } catch (err) { statusLabel.innerText = "Failed"; }
  });
});
