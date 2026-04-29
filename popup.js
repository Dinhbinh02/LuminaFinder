document.addEventListener('DOMContentLoaded', async () => {
  const downloadBtn = document.getElementById('download-btn');
  const copyBtn = document.getElementById('copy-btn');
  const optionSelect = document.getElementById('option-select');
  const optionSection = document.getElementById('option-section');
  const optionLabel = null;
  const statusLabel = document.getElementById('status');
  const targetTitleLabel = document.getElementById('target-title');
  const targetTypeBadge = document.getElementById('target-type');
  const folderContent = document.getElementById('folder-content');
  const fileListContainer = document.getElementById('file-list-container');
  const selectAllCheckbox = document.getElementById('select-all-checkbox');
  const reloadBtn = document.getElementById('reload-btn');

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

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tab.url;

  const cache = await chrome.storage.local.get(['lastState']);
  if (cache.lastState && cache.lastState.url === currentUrl) {
    currentTarget = cache.lastState;
    if (currentTarget.type === "folder") {
      renderState();
    } else {
      analyzeUrl(currentUrl, tab);
    }
  } else {
    analyzeUrl(currentUrl, tab);
  }

  // Poll background status every second
  setInterval(() => {
    chrome.runtime.sendMessage({ type: 'GET_DOWNLOAD_STATUS' }, response => {
      if (response && response.isProcessing) {
        statusLabel.innerText = `Downloading ${response.progress.current}/${response.progress.total}: ${response.progress.lastFileName}`;
        downloadBtn.disabled = true;
      } else if (downloadBtn.disabled && currentTarget.type === 'folder' && !currentTarget.isScanning) {
        statusLabel.innerText = "Complete.";
        downloadBtn.disabled = false;
        updateDownloadBtnState();
      }
    });
  }, 1000);

  async function analyzeUrl(url, tabObj) {
    console.log("Analyzing URL:", url);
    currentTarget = {
      id: '', type: 'none', title: '', url: url,
      downloadUrl: '', folderTree: null, isScanning: false,
      streams: []
    };
    renderState();

    const fileId = extractFileId(url);
    const folderId = extractFolderId(url);
    const docInfo = extractDocInfo(url);

    console.log("Extraction results:", { fileId, folderId, docInfo });

    if (folderId) {
      currentTarget.id = folderId; currentTarget.type = "folder";
      targetTitleLabel.innerText = "Folder";
      renderState();
      autoScanFolder();
    } else if (docInfo) {
      currentTarget.id = docInfo.id; currentTarget.type = docInfo.type;
      // Get title from tab and remove " - Google Docs/Sheets/Slides" suffix
      let cleanTitle = tabObj.title || "Document";
      cleanTitle = cleanTitle.replace(/ - Google (Docs|Sheets|Slides|Documents|Spreadsheets|Presentations)$/, "");
      currentTarget.title = cleanTitle;

      targetTitleLabel.innerText = currentTarget.title;
      renderState();

      // Determine internal type for options
      let internalType = "doc";
      if (currentTarget.type === "spreadsheets") internalType = "sheet";
      if (currentTarget.type === "presentation") internalType = "slide";

      setupExportOptions(internalType);
      saveState();
      statusLabel.innerText = "Complete.";
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
    targetTitleLabel.innerText = currentTarget.title || "Item";

    const selectAllGroup = document.getElementById('select-all-group');
    const targetHeader = document.querySelector('.target-header');
    targetHeader.style.marginBottom = "0";

    if (currentTarget.type === "folder") {
      folderContent.style.display = "block";
      selectAllGroup.style.display = "flex";
      if (!currentTarget.isScanning && currentTarget.folderTree) {
        targetHeader.style.marginBottom = "12px";
      }
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

    row.innerHTML = `
      <span class="toggle-icon">${toggleIconMarkup}</span>
      <input type="checkbox" class="node-checkbox" ${node.selected ? 'checked' : ''}>
      <span class="${isFolder ? 'folder-name' : 'file-name'}">${node.name}</span>
    `;

    row.querySelector('.toggle-icon').addEventListener('click', (e) => {
      e.stopPropagation();
      if (isFolder) { node.expanded = !node.expanded; renderTree(); saveState(); }
    });

    row.querySelector('.node-checkbox').addEventListener('click', (e) => {
      e.stopPropagation();
      propagateDown(node, e.target.checked);
      propagateUp(currentTarget.folderTree);
      updateSelectAllState();
      updateDownloadBtnState();
      renderTree();
      saveState();
    });

    row.addEventListener('click', (e) => {
      // If clicking toggle icon, expansion is handled by its own listener
      if (e.target.closest('.toggle-icon') && isFolder) return;
      // If clicking checkbox directly, its own listener handles it
      if (e.target.classList.contains('node-checkbox')) return;

      // Toggle selection for the entire row click
      propagateDown(node, !node.selected);
      propagateUp(currentTarget.folderTree);
      updateSelectAllState();
      updateDownloadBtnState();
      renderTree();
      saveState();
    });

    item.appendChild(row);
    container.appendChild(item);
    if (isFolder && node.expanded && node.children) node.children.forEach(child => renderNode(child, container, depth + 1));
  }

  function propagateDown(node, selected) {
    node.selected = selected;
    if (node.children) node.children.forEach(child => propagateDown(child, selected));
  }

  function propagateUp(node) {
    if (node.children && node.children.length > 0) {
      node.children.forEach(propagateUp);
      node.selected = node.children.every(child => child.selected);
    }
  }

  function updateDownloadBtnState() {
    if (currentTarget.type === "folder" && currentTarget.folderTree) {
      const allFiles = flattenFiles(currentTarget.folderTree);
      const selectedFiles = allFiles.filter(f => f.selected);
      downloadBtn.disabled = selectedFiles.length === 0;
      downloadBtn.innerText = selectedFiles.length === 0 ? "Select files" : `Download (${selectedFiles.length})`;
    }
  }

  function updateSelectAllState() {
    if (currentTarget.folderTree) {
      selectAllCheckbox.checked = currentTarget.folderTree.selected;
    }
  }

  function flattenFiles(node, path = "") {
    let files = [];
    const currentPath = path + (node.name ? node.name + "/" : "");
    if (node.type === 'file') files.push({ ...node, path: path + node.name });
    else if (node.children) node.children.forEach(child => { files = files.concat(flattenFiles(child, currentPath)); });
    return files;
  }

  selectAllCheckbox.addEventListener('change', (e) => {
    if (currentTarget.folderTree) {
      propagateDown(currentTarget.folderTree, e.target.checked);
      renderTree();
      updateDownloadBtnState();
      saveState();
    }
  });

  reloadBtn.addEventListener('click', () => {
    statusLabel.innerText = "Reloading...";
    analyzeUrl(currentUrl, tab);
  });

  function startDynamicStatus() {
    if (statusInterval) clearInterval(statusInterval);
    const words = ["Scanning", "Mapping", "Indexing", "Fetching", "Parsing"];
    let wordIdx = 0;
    let dotCount = 0;
    let cycleCount = 0;

    statusInterval = setInterval(() => {
      if (!currentTarget.isScanning) {
        clearInterval(statusInterval);
        return;
      }

      dotCount++;
      if (dotCount > 3) {
        dotCount = 1;
        cycleCount++;
      }

      if (cycleCount >= 2) {
        cycleCount = 0;
        // Move to next word only if not at the last word
        if (wordIdx < words.length - 1) {
          wordIdx++;
        }
      }

      statusLabel.innerText = words[wordIdx] + ".".repeat(dotCount);
    }, 500);
  }

  async function autoScanFolder() {
    if (currentTarget.isScanning) return;
    currentTarget.isScanning = true;
    startDynamicStatus();
    renderState();

    try {
      currentTarget.folderTree = await recursiveScanTree(currentTarget.id, "");
      currentTarget.isScanning = false;
      currentTarget.title = currentTarget.folderTree.name;
      statusLabel.innerText = "Complete.";
      renderState();
      saveState();
    } catch (e) {
      statusLabel.innerText = "Error: " + e.message;
      currentTarget.isScanning = false;
    }
  }

  async function recursiveScanTree(folderId, name) {
    const embeddedUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}`;
    const response = await proxyFetch(embeddedUrl);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const folderName = name || (doc.title ? doc.title.replace(" - Google Drive", "") : "Folder");
    const node = { id: folderId, name: folderName, type: 'folder', children: [], expanded: true, selected: true };

    // Find all links that look like Drive items
    const links = doc.querySelectorAll('a[href]');
    const seenIds = new Set();

    // Collect all sub-scan promises to run them in parallel
    const folderPromises = [];

    for (const link of links) {
      const href = link.getAttribute('href') || "";
      const childName = link.innerText.trim() || link.getAttribute('title') || link.getAttribute('aria-label') || "Item";

      let id = "";
      let type = "";

      if (href.includes("/folders/")) {
        const match = href.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (match) { id = match[1]; type = "folder"; }
      } else if (href.includes("/file/d/")) {
        const match = href.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (match) { id = match[1]; type = "file"; }
      } else if (href.includes("/d/")) {
        const match = href.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match) { id = match[1]; type = "file"; }
      }

      if (id && type && !seenIds.has(id)) {
        seenIds.add(id);
        if (type === "folder") {
          // Push promise to array instead of awaiting immediately
          folderPromises.push(recursiveScanTree(id, childName).then(subFolder => {
            node.children.push(subFolder);
            renderTree();
          }));
        } else {
          node.children.push({ id, name: childName, type: 'file', selected: true });
          renderTree();
        }
      }
    }

    // Wait for all subfolders in this level to finish in parallel
    await Promise.all(folderPromises);
    return node;
  }

  downloadBtn.addEventListener('click', async () => {
    console.log("Download clicked. Current Target:", currentTarget);

    if (currentTarget.type === "folder") {
      const selectedFiles = flattenFiles(currentTarget.folderTree).filter(f => f.selected);
      if (selectedFiles.length === 0) {
        statusLabel.innerText = "No files selected.";
        return;
      }
      
      chrome.runtime.sendMessage({ type: 'START_DOWNLOAD_QUEUE', files: selectedFiles }, response => {
        statusLabel.innerText = "Processing in background...";
        downloadBtn.disabled = true;
      });
    } else {
      const val = optionSelect.value;
      console.log("Export option selected:", val);

      if (val === "original" && currentTarget.downloadUrl) {
        console.log("Downloading original file:", currentTarget.downloadUrl);
        startDownload(currentTarget.downloadUrl, currentTarget.title);
      }
      else if (currentTarget.streams[val]) {
        console.log("Downloading stream:", val, currentTarget.streams[val].url);
        startDownload(currentTarget.streams[val].url, currentTarget.title + ".mp4");
      }
      else if (["document", "spreadsheets", "presentation"].includes(currentTarget.type)) {
        const url = `https://docs.google.com/${currentTarget.type}/d/${currentTarget.id}/export?format=${val}`;
        console.log("Exporting Google Doc/Sheet/Slide:", url);
        startDownload(url, currentTarget.title + "." + val);
      }
      else if (currentTarget.downloadUrl) {
        console.log("Downloading via direct link:", currentTarget.downloadUrl);
        startDownload(currentTarget.downloadUrl, currentTarget.title);
      } else {
        console.warn("No download URL or export path found for this item.");
      }
    }
  });

  function startDownload(url, filename) {
    let safeFilename = filename.replace(/[\\*?:"<>|]/g, "").trim();
    if (!safeFilename || safeFilename === "." + filename.split('.').pop()) {
      safeFilename = "Lumina_Download_" + Date.now() + (filename.includes('.') ? "." + filename.split('.').pop() : "");
    }
    console.log("Executing chrome.downloads.download:", { url, filename: safeFilename });
    chrome.downloads.download({ url, filename: safeFilename, saveAs: false }, (id) => {
      if (chrome.runtime.lastError) {
        console.error("Chrome Download Error:", chrome.runtime.lastError.message);
      } else {
        console.log("Download started successfully. ID:", id);
      }
    });
  }

  function extractConfirmLink(html) {
    const hrefMatch = html.match(/href="(\/uc\?export=download[^"]+)/);
    if (hrefMatch) return "https://docs.google.com" + hrefMatch[1].replace(/&amp;/g, "&");
    const dlMatch = html.match(/"downloadUrl":"([^"]+)"/);
    if (dlMatch) return dlMatch[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
    return null;
  }
  function extractFileId(url) {
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : (url.includes('id=') ? new URLSearchParams(new URL(url).search).get('id') : null);
  }
  function extractFolderId(url) {
    const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }
  function extractDocInfo(url) {
    const segments = ['document', 'spreadsheets', 'presentation'];
    for (const segment of segments) {
      // Support both docs.google.com and drive.google.com patterns
      if (url.includes(`google.com/${segment}/d/`)) {
        const idMatch = url.match(new RegExp(`${segment}/d/([a-zA-Z0-9_-]+)`));
        if (idMatch) return { id: idMatch[1], type: segment };
      }
    }
    // Also catch generic docs link if ID is in URL but segment is missing
    if (url.includes('google.com/docs/d/')) {
      const idMatch = url.match(/\/docs\/d\/([a-zA-Z0-9_-]+)/);
      if (idMatch) return { id: idMatch[1], type: 'document' };
    }
    return null;
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
  async function checkFileInfo(id) {
    const ucUrl = `https://drive.google.com/uc?id=${id}&export=download`;
    const ucRes = await proxyFetch(ucUrl);
    const ucHtml = await ucRes.text();
    const titleMatch = ucHtml.match(/<title>(.*?) - Google Drive<\/title>/);
    if (titleMatch) { currentTarget.title = titleMatch[1]; targetTitleLabel.innerText = currentTarget.title; }
    const confirmUrl = extractConfirmLink(ucHtml);
    if (confirmUrl) currentTarget.downloadUrl = confirmUrl;
    const infoUrl = `https://drive.google.com/u/0/get_video_info?docid=${id}&drive_originator_app=303`;
    try {
      const infoRes = await proxyFetch(infoUrl);
      const infoText = await infoRes.text();
      const params = parseParams(infoText);
      const streams = parseStreams(params);
      if (streams.length > 0) currentTarget.streams = streams;
    } catch (e) { }
    renderState();
  }
  function setupQualityOptions(streams, hasHighSpeedLink) {
    // optionLabel removed
    optionSelect.innerHTML = "";
    if (hasHighSpeedLink) { const opt = document.createElement('option'); opt.value = "original"; opt.text = "Original Link"; optionSelect.appendChild(opt); }
    streams.forEach((s, i) => { const opt = document.createElement('option'); opt.value = i; opt.text = s.priority > 0 ? `${s.priority}p` : `itag ${s.itag}`; optionSelect.appendChild(opt); });
    optionSection.style.display = "block";
  }
  function setupExportOptions(type) {
    // optionLabel removed
    optionSelect.innerHTML = "";
    let formats = [];
    if (type === "doc") formats = ["pdf", "docx", "txt", "odt"];
    else if (type === "sheet") formats = ["pdf", "xlsx", "csv", "ods"];
    else if (type === "slide") formats = ["pdf", "pptx", "txt"];
    formats.forEach(f => { const opt = document.createElement('option'); opt.value = f; opt.text = f.toUpperCase(); optionSelect.appendChild(opt); });
    optionSection.style.display = "block";
  }
  copyBtn.addEventListener('click', async () => {
    try {
      const driveCookies = await chrome.cookies.getAll({ domain: "drive.google.com" });
      const googleCookies = await chrome.cookies.getAll({ domain: "google.com" });
      const allCookies = [...driveCookies, ...googleCookies];
      const uniqueCookies = Array.from(new Map(allCookies.map(c => [c.name, c])).values());
      const data = { id: currentTarget.id, type: currentTarget.type, title: currentTarget.title, cookies: uniqueCookies, url: currentUrl };
      await navigator.clipboard.writeText(JSON.stringify(data));
      copyBtn.innerText = "Copied";
      setTimeout(() => { copyBtn.innerText = "Metadata"; }, 2000);
    } catch (err) { statusLabel.innerText = "Failed"; }
  });
});
